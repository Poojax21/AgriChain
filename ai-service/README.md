# AgriChain Fruit & Vegetable Quality Model

The verification service uses a locally fine-tuned MobileNetV3-Small model. It predicts `Good`, `Mixed`, or `Bad` produce quality from a real inspection photo, then signs the result for the local oracle flow. Thirteen crops are trained: Apple, Banana, Guava, Lime, Orange, Pomegranate (FruitNet, with Mixed examples) plus Mango, Tomato, Potato, Strawberry, Bellpepper, Cucumber, Carrot (fresh/rotten only — the Mixed class remains FruitNet-sourced). It does not estimate shelf life, pesticide residues, or food safety. Crops outside the trained list are graded by a deterministic rule-based screening (`gradingMethod: heuristic-screening`, capped confidence) — disclosed as such in every response and signed report, never as a model prediction.

## Dataset and attribution

Training photos and labels come from **FruitNet: Indian fruits image dataset with quality** by Vishal Meshram and Kailas Patil. The original dataset is hosted on Mendeley Data at [DOI 10.17632/b6fftwbr2v.3](https://doi.org/10.17632/b6fftwbr2v.3) under CC BY 4.0. The public Kaggle mirror used by the downloader declares CC BY-SA 4.0, so this project's redistributed model and selected dataset photos are attributed and shared under CC BY-SA 4.0.

Citation: V. Meshram and K. Patil, “FruitNet: Indian fruits image dataset with quality for machine learning applications,” *Data in Brief*, vol. 40, 107686, 2022. https://doi.org/10.1016/j.dib.2021.107686.

The dataset contains real phone photographs gathered under varied backgrounds and lighting. It covers apple, banana, guava, lime, orange, and pomegranate with Good, Bad, and Mixed quality labels. This does not include mango, rice, tomato, onion, chilli, or turmeric, so the model rejects those crop names.

## Download and train

From the repository root in PowerShell:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" ai-service/download_fruitnet.py
& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" ai-service/train_fruitnet.py
```

The downloader verifies the public mirror's CC BY-SA 4.0 license, records dataset provenance, downloads and extracts the actual photos. Training fine-tunes ImageNet-initialized MobileNetV3-Small with a fixed seed and class-weighted loss. It uses a 70/15/15 stratified train/validation/test split, caps training at 15,000 photos (FruitNet core plus up to 500 per class from each extra CC0 source), and leaves validation and test photos untouched. The model is trained for three epochs at 128×128; the report records the exact sample counts, metrics, and confusion matrix. The held-out test report is written to `ai-service/models/fruitnet_metrics.json` and included in the service's `/model-info` response. Current production checkpoint: 13 crops, 96.95% test accuracy (2026-10).

A deterministic defect safety floor backs the model with a dual gate: a `Good` verdict is downgraded only when the model is unconvincing (top softmax below 0.95) AND extensive dark decay is measured. Confident model verdicts always stand — probing showed single-gate thresholds vandalize healthy dark-skinned produce (fresh mango, carrots, strawberries), so the confidence gate is load-bearing, not decorative. The cap, the raw scores, and the defect overlay ship in every signed report.

Install the packages in `requirements.txt` into the Python environment used by the AI service. The checked-in model checkpoint is `ai-service/models/fruitnet_mobilenet_v3_small.pth`. Raw images and archive remain local under `ai-service/data/`.

The on-chain Grade A/B/C mapping is Good/Mixed/Bad, respectively. The reported score is an **uncalibrated softmax score**, not the probability a lot is safe or the accuracy of the model on that image. The validation and held-out test metrics describe only the recorded dataset split and do not guarantee field performance.
