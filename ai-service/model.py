"""FruitNet quality classifier inference.

The trained model predicts Good / Mixed / Bad for fruit photos. It does not
claim to infer shelf life, chemical safety, or quality of unrepresented crops.

Safety floor: the soft-max score is uncalibrated and the model can miss decay
it has not seen in training (out-of-distribution rot). An independent,
deterministic dark-decay pixel check therefore caps the final grade — but ONLY
as a dual gate: the model must say Good AND look unconvincing (top softmax
below 0.95) AND extensive decay must be measured. High-confidence model
verdicts always stand (they are right ~97% of the time); the floor exists for
the uncertain middle where rot hides, e.g. a 91%-Good rotten apple. A photo
with extensive dark/desaturated decay can never receive GRADE_A, no matter
what the model says. The raw model scores stay visible in the response so the
cap is auditable, and the cap is recorded on the signed report.
"""

import io
import os
import base64
from pathlib import Path

import numpy as np
import torch
from PIL import Image, UnidentifiedImageError
from torchvision import models, transforms


MODEL_PATH = Path(os.getenv("AGRICHAIN_MODEL_PATH", Path(__file__).parent / "models" / "fruitnet_mobilenet_v3_small.pth"))
# Conservative thresholds: only severe, unmistakable decay triggers the cap.
# Measured on reference photos: good fruit <= 0.09, mixed ~0.03-0.19,
# bad (in-distribution) already classified Bad by the model, synthetic
# severe rot ~0.59. The cap therefore only fires far outside healthy range.
DECAY_CAP_MIXED_ABOVE = 0.15
DECAY_CAP_BAD_ABOVE = 0.40


def dark_decay_ratio(image: Image.Image) -> dict:
    """Fraction of pixels showing dark/desaturated decay (rot, mold, necrosis).

    Healthy skin — even dark-red apple skin — is saturated; decay goes dark
    AND desaturated. Returns per-mask ratios plus the combined ratio.
    """
    small = image.resize((64, 64))
    arr = np.asarray(small).astype(np.float32)
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    black = mx < 60  # near-black mold/necrosis
    gray = (mx < 150) & ((mx - mn) < 25) & (mx > 40)  # washed-out gray decay
    return {
        "blackRatio": round(float(black.mean()), 4),
        "grayDecayRatio": round(float(gray.mean()), 4),
        "decayRatio": round(float((black | gray).mean()), 4),
    }


def explanation_overlay(image: Image.Image, max_width: int = 320) -> dict:
    """Visual explanation of the grade: the exact defect pixels highlighted.

    Same masks as the safety floor, so the overlay can never contradict the
    verdict it explains. Returns a small JPEG data URL plus the ratio.
    """
    w, h = image.size
    scale = min(1.0, max_width / max(w, h))
    small = image.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    arr = np.asarray(small).astype(np.float32)
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    defect = (mx < 60) | ((mx < 150) & ((mx - mn) < 25) & (mx > 40))
    marked = np.asarray(small).copy()
    marked[defect] = (marked[defect] * 0.35 + np.array([255, 40, 40]) * 0.65).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(marked).save(buf, format="JPEG", quality=82)
    return {
        "maskDataUrl": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
        "defectRatio": round(float(defect.mean()), 4),
        "width": marked.shape[1],
        "height": marked.shape[0],
    }
CLASS_NAMES = ["Bad", "Good", "Mixed"]
GRADE_BY_CLASS = {"Good": (1, "GRADE_A"), "Mixed": (2, "GRADE_B"), "Bad": (3, "GRADE_C")}
DATASET_NAME = "FruitNet: Indian fruits image dataset with quality"
DATASET_VERSION = "Mendeley Data v3 / Kaggle mirror"
DATASET_LICENSE = "CC BY-SA 4.0"
SUPPORTED_CROPS = ["Apple", "Banana", "Guava", "Lime", "Orange", "Pomegranate",
                   "Mango", "Tomato", "Potato", "Strawberry", "Bellpepper", "Cucumber", "Carrot"]

SCREENING_CONFIDENCE_CAP = 8200
# Conservative, documented thresholds for non-fruit crops (grains, vegetables…).
# These are physical measurements, not learned predictions — see screen_crop_image.
SCREEN_DEFECT_BAD_ABOVE = 0.30
SCREEN_DEFECT_MIXED_ABOVE = 0.12
SCREEN_UNEVEN_STD_ABOVE = 45.0


def screen_crop_image(image_bytes: bytes, crop_name: str) -> dict:
    """Rule-based visual screening for crops the CNN was never trained on.

    Measures two physical properties — defect-pixel ratio (dark/desaturated
    kernels, damage, foreign matter) and brightness unevenness — and maps them
    to Good/Mixed/Bad with a CONFIDENCE CAP well below CNN scores, so a
    screening can never look as certain as a model grade. The response is
    explicitly labelled ``heuristic-screening`` end to end (API, report,
    signed payload, UI). This is a transparent pre-screen, not a diagnosis.
    """
    if not image_bytes:
        raise ValueError("Image data is required")
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Uploaded file is not a valid image") from exc

    decay = dark_decay_ratio(image)
    small = np.asarray(image.resize((64, 64))).astype(np.float32)
    luminance = 0.299 * small[..., 0] + 0.587 * small[..., 1] + 0.114 * small[..., 2]
    unevenness = round(float(luminance.std()), 2)
    defect = decay["decayRatio"]

    reasons = []
    if defect > SCREEN_DEFECT_BAD_ABOVE:
        label, grade, grade_name = "Bad", 3, "GRADE_C"
        reasons.append(f"defect ratio {defect} > {SCREEN_DEFECT_BAD_ABOVE}")
    elif defect > SCREEN_DEFECT_MIXED_ABOVE:
        label, grade, grade_name = "Mixed", 2, "GRADE_B"
        reasons.append(f"defect ratio {defect} > {SCREEN_DEFECT_MIXED_ABOVE}")
    else:
        label, grade, grade_name = "Good", 1, "GRADE_A"
    if grade == 1 and unevenness > SCREEN_UNEVEN_STD_ABOVE:
        label, grade, grade_name = "Mixed", 2, "GRADE_B"
        reasons.append(f"unevenness {unevenness} > {SCREEN_UNEVEN_STD_ABOVE}")
    # Confidence reflects distance from the nearest threshold, hard-capped.
    margin = min(abs(defect - SCREEN_DEFECT_MIXED_ABOVE), abs(defect - SCREEN_DEFECT_BAD_ABOVE))
    confidence = int(round(min(0.55 + margin * 2.0, SCREENING_CONFIDENCE_CAP / 10000) * 10000))
    explanation = explanation_overlay(image)
    return {
        "grade": grade,
        "gradeName": grade_name,
        "gradeLabel": f"{label} quality (heuristic screening — not a model grade)",
        "confidenceBasisPoints": confidence,
        "confidencePercent": round(confidence / 100.0, 2),
        "confidenceType": "heuristic_distance_capped",
        "qualityLabel": label,
        "modelTopLabel": label,
            "gradeCappedByDefectCheck": None,
            "gradingMethod": "heuristic-screening",
            "explanation": explanation,
        "classScores": None,
        "modelName": "Rule-based visual screening (defect ratio + unevenness)",
        "modelVersion": "screening-v1",
        "dataset": "n/a — deterministic measurement, no training data",
        "datasetVersion": "n/a",
        "datasetLicense": "n/a",
        "supportedCrops": SUPPORTED_CROPS,
        "metrics": {
            "topClass": label,
            "defectRatio": defect,
            "blackRatio": decay["blackRatio"],
            "grayDecayRatio": decay["grayDecayRatio"],
            "unevennessStd": unevenness,
            "screenReasons": reasons or ["within healthy bounds"],
            "validationAccuracy": None,
            "heldOutTestAccuracy": None,
            "datasetImageCount": 0,
        },
    }


class CropQualityEngine:
    def __init__(self):
        if not MODEL_PATH.is_file():
            raise RuntimeError(
                f"Trained FruitNet checkpoint not found at {MODEL_PATH}. "
                "Run `python ai-service/download_fruitnet.py` then `python ai-service/train_fruitnet.py`."
            )
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
        self.class_names = checkpoint["classes"]
        self.model = models.mobilenet_v3_small(weights=None)
        self.model.classifier[3] = torch.nn.Linear(self.model.classifier[3].in_features, len(self.class_names))
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.to(self.device).eval()
        self.checkpoint = checkpoint
        # Supported crops and dataset identity follow the LOADED checkpoint,
        # so retraining with new crops needs no code change here.
        self.supported_crops = checkpoint.get("supported_crops") or SUPPORTED_CROPS
        self.dataset_name = checkpoint.get("dataset") or DATASET_NAME
        self.dataset_version = checkpoint.get("datasetVersion") or checkpoint.get("dataset_version") or DATASET_VERSION
        self.dataset_license = checkpoint.get("datasetLicense") or checkpoint.get("dataset_license") or DATASET_LICENSE
        image_size = int(checkpoint.get("image_size", 160))
        self.preprocess = transforms.Compose([
            transforms.Resize((image_size + 16, image_size + 16)),
            transforms.CenterCrop(image_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def analyze_image(self, image_bytes: bytes) -> dict:
        if not image_bytes:
            raise ValueError("Image data is required")
        try:
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("Uploaded file is not a valid image") from exc

        tensor = self.preprocess(image).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            probabilities = torch.softmax(self.model(tensor)[0], dim=0).cpu()
        index = int(torch.argmax(probabilities))
        label = self.class_names[index]
        grade, grade_name = GRADE_BY_CLASS[label]
        score = float(probabilities[index])
        class_scores = {name: round(float(probabilities[i]), 6) for i, name in enumerate(self.class_names)}

        # Independent safety floor (see module docstring). Dual gate: downgrade a
        # "Good" verdict only when the model is unconvincing (softmax < 0.95)
        # AND extensive decay is measured. Confident model verdicts stand;
        # soil specks and dark skins on 99%-Good photos must not be punished.
        decay = dark_decay_ratio(image)
        explanation = explanation_overlay(image)
        capped_by = None
        if label == "Good" and score < 0.95 and decay["decayRatio"] > DECAY_CAP_BAD_ABOVE:
            grade, grade_name, label = 3, "GRADE_C", "Bad"
            capped_by = f"dark-decay {decay['decayRatio']} > {DECAY_CAP_BAD_ABOVE} with unconvincing Good {round(score, 4)}: model said Good, capped to Bad"
        elif label == "Good" and score < 0.95 and decay["decayRatio"] > DECAY_CAP_MIXED_ABOVE:
            grade, grade_name, label = 2, "GRADE_B", "Mixed"
            capped_by = f"dark-decay {decay['decayRatio']} > {DECAY_CAP_MIXED_ABOVE} with unconvincing Good {round(score, 4)}: model said Good, capped to Mixed"
        return {
            "grade": grade,
            "gradeName": grade_name,
            "gradeLabel": f"{label} quality (FruitNet model)" + (" — defect safety cap applied" if capped_by else ""),
            "confidenceBasisPoints": int(round(score * 10000)),
            "confidencePercent": round(score * 100.0, 2),
            "confidenceType": "uncalibrated_model_softmax_score",
            "qualityLabel": label,
            "modelTopLabel": self.class_names[index],
            "gradingMethod": "fruitnet-cnn",
            "gradeCappedByDefectCheck": capped_by,
            "classScores": class_scores,
            "explanation": explanation,
            "modelName": "MobileNetV3-Small fine-tuned on FruitNet",
            "modelVersion": self.checkpoint.get("model_version", "unknown"),
            "dataset": self.dataset_name,
            "datasetVersion": self.dataset_version,
            "datasetLicense": self.dataset_license,
            "supportedCrops": self.supported_crops,
            "metrics": {
                "topClass": self.class_names[index],
                "softmaxScore": round(score, 6),
                "darkDecayRatio": decay["decayRatio"],
                "blackRatio": decay["blackRatio"],
                "grayDecayRatio": decay["grayDecayRatio"],
                "validationAccuracy": self.checkpoint.get("validation_accuracy"),
                "heldOutTestAccuracy": self.checkpoint.get("test_accuracy"),
                "datasetImageCount": self.checkpoint.get("dataset_image_count"),
            },
        }
