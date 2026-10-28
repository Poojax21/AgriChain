"""Fine-tune MobileNetV3-Small on real FruitNet Good/Bad/Mixed photos."""

import json
import os
import random
import re
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, confusion_matrix
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "fruitnet"
MODEL_DIR = ROOT / "models"
MODEL_OUT = MODEL_DIR / "fruitnet_mobilenet_v3_small.pth"
CLASSES = ["Bad", "Good", "Mixed"]
CROPS = ["Apple", "Banana", "Guava", "Lime", "Orange", "Pomegranate",
         "Mango", "Tomato", "Potato", "Strawberry", "Bellpepper", "Cucumber", "Carrot"]
# Additional labeled sources merged in later (e.g. CC0 fresh/rotten sets).
# Each entry: data root + crops it contributes + max rows per (crop, quality)
# so new sources extend coverage without drowning the proven FruitNet core.
EXTRA_SOURCES: list = [
    {"root": ROOT / "data" / "freshveg",
     "crops": ["Mango", "Tomato", "Potato", "Strawberry", "Bellpepper", "Cucumber", "Carrot"],
     "cap_per_class": 500},
]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
SEED = 42
IMAGE_SIZE = int(os.getenv("FRUITNET_IMAGE_SIZE", "128"))
MAX_TRAIN_IMAGES = int(os.getenv("FRUITNET_MAX_TRAIN_IMAGES", "15000"))
EPOCHS = int(os.getenv("FRUITNET_EPOCHS", "3"))


def get_quality(path: Path):
    for part in reversed(path.parts):
        text = re.sub(r"[^a-z]", "", part.lower())
        if "mixed" in text or "uneven" in text:
            return "Mixed"
        if "bad" in text or "poor" in text or "rotten" in text or "spoiled" in text:
            return "Bad"
        if "good" in text or "fresh" in text:
            return "Good"
    return None


def get_crop(path: Path):
    text = " ".join(path.parts).lower()
    for crop in CROPS:
        if re.search(rf"\b{crop.lower()}\b", text):
            return crop
    # Source folders sometimes concatenate crop names with their quality label.
    for crop in CROPS:
        if crop.lower() in text:
            return crop
    return None


def collect_images():
    paths = [p for p in DATA_DIR.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES]
    records = []
    for path in paths:
        quality = get_quality(path)
        crop = get_crop(path)
        if quality and crop:
            records.append({"path": path, "label": CLASSES.index(quality), "quality": quality, "crop": crop, "source": "fruitnet"})
    for source in EXTRA_SOURCES:
        root = Path(source["root"])
        if not root.is_dir():
            print(f"Extra source missing, skipped: {root}", flush=True)
            continue
        allowed = set(source.get("crops", []))
        cap = int(source.get("cap_per_class", 500))
        for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES):
            quality = get_quality(path)
            crop = get_crop(path)
            if quality and crop and crop in allowed:
                records.append({"path": path, "label": CLASSES.index(quality), "quality": quality, "crop": crop, "source": root.name})
    # Cap extra-source rows per (crop, quality): extend coverage, don't drown the core.
    for source in EXTRA_SOURCES:
        cap = int(source.get("cap_per_class", 500))
        for crop in source.get("crops", []):
            for quality in CLASSES:
                bucket = [r for r in records if r.get("source") not in (None, "fruitnet") and r["crop"] == crop and r["quality"] == quality]
                rng = random.Random(SEED)
                rng.shuffle(bucket)
                drop = set(map(id, bucket[cap:]))
                records = [r for r in records if id(r) not in drop]
    counts = Counter(row["quality"] for row in records)
    if len(counts) != 3 or min(counts.values(), default=0) < 30:
        examples = [str(p.relative_to(DATA_DIR)) for p in paths[:12]]
        raise RuntimeError(f"Could not find all quality classes in extracted FruitNet paths. Counts={dict(counts)}; examples={examples}")
    print(f"Sources: {dict(Counter(r.get('source', 'fruitnet') for r in records))}", flush=True)
    return records


def make_splits(records):
    random.seed(SEED)
    splits = {"train": [], "validation": [], "test": []}
    for label in range(len(CLASSES)):
        rows = [row for row in records if row["label"] == label]
        random.shuffle(rows)
        n = len(rows)
        n_train, n_validation = int(n * 0.70), int(n * 0.15)
        for key, group in (("train", rows[:n_train]), ("validation", rows[n_train:n_train+n_validation]), ("test", rows[n_train+n_validation:])):
            splits[key].extend(group)
    return splits


def cap_training_split(train_rows):
    if MAX_TRAIN_IMAGES <= 0 or len(train_rows) <= MAX_TRAIN_IMAGES:
        return train_rows
    rng = random.Random(SEED)
    selected = []
    for label in range(len(CLASSES)):
        rows = [row for row in train_rows if row["label"] == label]
        quota = max(1, round(MAX_TRAIN_IMAGES * len(rows) / len(train_rows)))
        rng.shuffle(rows)
        selected.extend(rows[:quota])
    rng.shuffle(selected)
    return selected[:MAX_TRAIN_IMAGES]


class FruitNetImages(Dataset):
    def __init__(self, rows, training=False):
        self.rows = rows
        self.transform = transforms.Compose([
            transforms.Resize((IMAGE_SIZE + 16, IMAGE_SIZE + 16)),
            transforms.RandomHorizontalFlip() if training else transforms.Lambda(lambda image: image),
            transforms.RandomRotation(12) if training else transforms.Lambda(lambda image: image),
            transforms.ColorJitter(brightness=0.12, contrast=0.12, saturation=0.08) if training else transforms.Lambda(lambda image: image),
            transforms.CenterCrop(IMAGE_SIZE),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        row = self.rows[index]
        with Image.open(row["path"]) as image:
            tensor = self.transform(image.convert("RGB"))
        return tensor, row["label"]


def evaluate(model, loader, device):
    truth, predictions = [], []
    model.eval()
    with torch.inference_mode():
        for images, labels in loader:
            logits = model(images.to(device))
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
            truth.extend(labels.tolist())
    return {
        "accuracy": round(float(accuracy_score(truth, predictions)), 6),
        "balanced_accuracy": round(float(balanced_accuracy_score(truth, predictions)), 6),
        "classification_report": classification_report(truth, predictions, labels=list(range(len(CLASSES))), target_names=CLASSES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(truth, predictions, labels=list(range(len(CLASSES)))).tolist(),
    }


def main():
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    records = collect_images()
    splits = make_splits(records)
    splits["train"] = cap_training_split(splits["train"])
    print(f"FruitNet supported photos: {len(records)}; class counts: {dict(Counter(row['quality'] for row in records))}", flush=True)
    print(f"Split sizes: { {name: len(rows) for name, rows in splits.items()} }; device: {device}", flush=True)

    with (ROOT / "data" / "fruitnet_splits.json").open("w", encoding="utf-8") as output:
        def rel(row):
            try:
                return row["path"].relative_to(DATA_DIR).as_posix()
            except ValueError:
                return row["path"].relative_to(ROOT / "data").as_posix()
        json.dump({name: [{"path": rel(row), "quality": row["quality"], "crop": row["crop"]} for row in rows] for name, rows in splits.items()}, output, indent=2)

    batch_size = int(os.getenv("FRUITNET_BATCH_SIZE", "64"))
    loaders = {
        "train": DataLoader(FruitNetImages(splits["train"], training=True), batch_size=batch_size, shuffle=True, num_workers=0),
        "validation": DataLoader(FruitNetImages(splits["validation"]), batch_size=batch_size, shuffle=False, num_workers=0),
        "test": DataLoader(FruitNetImages(splits["test"]), batch_size=batch_size, shuffle=False, num_workers=0),
    }
    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
    model.classifier[3] = nn.Linear(model.classifier[3].in_features, len(CLASSES))
    model.to(device)
    class_counts = Counter(row["label"] for row in splits["train"])
    weights = torch.tensor([len(splits["train"]) / (len(CLASSES) * class_counts[index]) for index in range(len(CLASSES))], dtype=torch.float32, device=device)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.0003, weight_decay=0.0001)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, EPOCHS))
    best_state, best_accuracy = None, -1.0
    epochs = EPOCHS

    for epoch in range(epochs):
        model.train()
        running_loss = 0.0
        for step, (images, labels) in enumerate(loaders["train"], start=1):
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()
            running_loss += float(loss.detach().cpu())
            if step % 40 == 0:
                print(f"Epoch {epoch+1}/{epochs}: batch {step}/{len(loaders['train'])}, loss {running_loss / step:.4f}", flush=True)
        scheduler.step()
        validation = evaluate(model, loaders["validation"], device)
        print(f"Epoch {epoch+1}/{epochs}: train loss {running_loss / max(1,len(loaders['train'])):.4f}; validation accuracy {validation['accuracy']:.4f}; balanced {validation['balanced_accuracy']:.4f}", flush=True)
        if validation["accuracy"] > best_accuracy:
            best_accuracy, best_state = validation["accuracy"], {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

    model.load_state_dict(best_state)
    test = evaluate(model, loaders["test"], device)
    validation = evaluate(model, loaders["validation"], device)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "classes": CLASSES,
        "supported_crops": CROPS,
        "model_architecture": "torchvision.mobilenet_v3_small",
        "model_version": "fruitnet-freshveg-mobilenet-v3-small-2026-10",
        "training_method": f"ImageNet pretrained weights fine-tuned locally on {len(splits['train'])} real photos (FruitNet + CC0 fresh/rotten fruit & vegetable set); class-weighted cross entropy; {EPOCHS} epochs; {IMAGE_SIZE}x{IMAGE_SIZE}; 70/15/15 stratified splits by quality label; seed 42",
        "dataset": "FruitNet (Mendeley 10.17632/b6fftwbr2v.3) + muhriddinmuxiddinov/fruits-and-vegetables-dataset (CC0 Kaggle mirror)",
        "dataset_source": "https://data.mendeley.com/datasets/b6fftwbr2v/3 + https://www.kaggle.com/datasets/muhriddinmuxiddinov/fruits-and-vegetables-dataset",
        "dataset_doi": "10.17632/b6fftwbr2v.3",
        "dataset_license": "CC BY-SA 4.0 (FruitNet mirror) + CC0 (fresh/rotten fruit & vegetable set)",
        "dataset_image_count": len(records),
        "split_sizes": {name: len(rows) for name, rows in splits.items()},
        "class_counts": dict(Counter(row["quality"] for row in records)),
        "validation_accuracy": validation["accuracy"],
        "validation_balanced_accuracy": validation["balanced_accuracy"],
        "validation_report": validation["classification_report"],
        "test_accuracy": test["accuracy"],
        "test_balanced_accuracy": test["balanced_accuracy"],
        "test_report": test["classification_report"],
        "test_confusion_matrix_labels": CLASSES,
        "test_confusion_matrix": test["confusion_matrix"],
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "image_size": IMAGE_SIZE,
    }
    torch.save(checkpoint, MODEL_OUT)
    metrics_path = MODEL_DIR / "fruitnet_metrics.json"
    metrics_path.write_text(json.dumps({key: value for key, value in checkpoint.items() if key != "model_state_dict"}, indent=2) + "\n", encoding="utf-8")
    # Preserve real, individually attributable sample photos in the web demo.
    featured = [("Apple", "Good"), ("Banana", "Mixed"), ("Guava", "Bad"), ("Lime", "Good"), ("Orange", "Mixed"), ("Pomegranate", "Bad"),
                ("Mango", "Good"), ("Tomato", "Bad"), ("Potato", "Good"), ("Strawberry", "Bad")]
    assets = ROOT.parent / "frontend" / "public" / "crop-photos"
    assets.mkdir(parents=True, exist_ok=True)
    for crop, quality in featured:
        candidates = sorted((row for row in records if row["crop"] == crop and row["quality"] == quality), key=lambda row: row["path"].as_posix())
        if not candidates:
            raise RuntimeError(f"FruitNet does not contain a {crop}/{quality} sample.")
        with Image.open(candidates[0]["path"]) as source_image:
            source_image.convert("RGB").save(assets / f"{crop.lower()}-{quality.lower()}.jpg", format="JPEG", quality=94, optimize=True)
    print(f"Saved trained checkpoint: {MODEL_OUT}", flush=True)
    print(f"Copied six real FruitNet sample photos to {assets}", flush=True)
    print(json.dumps({"validation_accuracy": validation["accuracy"], "validation_balanced_accuracy": validation["balanced_accuracy"], "test_accuracy": test["accuracy"], "test_balanced_accuracy": test["balanced_accuracy"], "test_confusion_matrix": test["confusion_matrix"], "metrics": str(metrics_path)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
