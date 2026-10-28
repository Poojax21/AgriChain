import os
import hashlib
import time
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from dotenv import load_dotenv

from model import CropQualityEngine, screen_crop_image, SUPPORTED_CROPS
from oracle_signer import OracleSigner

load_dotenv("../.env")

app = FastAPI(
    title="AgriChain AI Quality Verification Microservice",
    description="FruitNet-trained fruit quality classification, inspection reports, and cryptographic Oracle signing.",
    version="2.0.0"
)

# Initialize singletons
quality_engine = CropQualityEngine()
oracle_signer = OracleSigner()

@app.get("/")
def root():
    return {
        "service": "AgriChain AI Fruit Quality Verification Oracle",
        "status": "online",
        "oracleNodeAddress": oracle_signer.address,
        "model": quality_engine.checkpoint.get("model_version"),
        "trainedModel": True,
        "version": "2.0.0"
    }

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "oracleAddress": oracle_signer.address,
        "model": quality_engine.checkpoint.get("model_version"),
        "testAccuracy": quality_engine.checkpoint.get("test_accuracy"),
        "timestamp": int(time.time())
    }

@app.get("/model-info")
def model_info():
    checkpoint = quality_engine.checkpoint
    return {
        "model": checkpoint.get("model_version"),
        "architecture": checkpoint.get("model_architecture"),
        "trainedAt": checkpoint.get("trained_at_utc"),
        "dataset": checkpoint.get("dataset"),
        "datasetSource": checkpoint.get("dataset_source"),
        "datasetLicense": checkpoint.get("dataset_license"),
        "imageCount": checkpoint.get("dataset_image_count"),
        "classCounts": checkpoint.get("class_counts"),
        "validationAccuracy": checkpoint.get("validation_accuracy"),
        "testAccuracy": checkpoint.get("test_accuracy"),
        "testBalancedAccuracy": checkpoint.get("test_balanced_accuracy"),
        "testConfusionMatrix": checkpoint.get("test_confusion_matrix"),
        "classes": checkpoint.get("classes"),
        "supportedCrops": checkpoint.get("supported_crops"),
        "scoreMeaning": "Uncalibrated model softmax score; not a probability of food safety or shelf life."
    }

@app.post("/api/verify")
async def verify_crop_batch(
    tokenId: int = Form(...),
    cropType: str = Form("Basmati Rice"),
    chainId: int = Form(31337),
    registryAddress: str = Form("0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"),
    imageFile: UploadFile = File(...),
    captureLat: Optional[float] = Form(None),
    captureLon: Optional[float] = Form(None),
    captureCapturedAt: Optional[int] = Form(None),
    captureHash: Optional[str] = Form(None),
    captureMethod: Optional[str] = Form(None),
):
    """
    Evaluates crop inspection photographs and returns an on-chain signable verification package.
    Optional live-capture fields bind device-claimed GPS/time into the SIGNED
    report (tamper-evident, not truth-verified: a screen can be re-photographed).
    """
    try:
        image_bytes = await imageFile.read()
        if not imageFile.content_type or not imageFile.content_type.startswith("image/"):
            raise ValueError("Uploaded file must be an image")
        image_hash = "sha256:" + hashlib.sha256(image_bytes).hexdigest()

        supported_crops = {crop.lower() for crop in quality_engine.supported_crops}
        # FruitNet CNN for the six trained fruits; transparent rule-based
        # screening for every other crop (grains, vegetables, …). Screening
        # never claims to be a model grade — see gradingMethod in the report.
        if cropType.strip().lower() in supported_crops:
            analysis = quality_engine.analyze_image(image_bytes)
        else:
            analysis = screen_crop_image(image_bytes, cropType.strip())

        capture = None
        if captureLat is not None and captureLon is not None:
            capture = {
                "method": captureMethod or "device-claimed",
                "lat": captureLat,
                "lon": captureLon,
                "capturedAt": captureCapturedAt,
                "captureHash": captureHash,
                "disclaimer": "Device-claimed GPS/time bound into this report; not independently verified.",
            }

        # Generate canonical inspection report
        report = {
            "tokenId": tokenId,
            "cropType": cropType,
            "imageHash": image_hash,
            "grade": analysis["grade"],
            "gradeName": analysis["gradeName"],
            "confidenceBasisPoints": analysis["confidenceBasisPoints"],
            "metrics": analysis["metrics"],
            "model": analysis["modelName"],
            "modelVersion": analysis["modelVersion"],
            "dataset": analysis["dataset"],
            "datasetVersion": analysis["datasetVersion"],
            "datasetLicense": analysis["datasetLicense"],
            "classScores": analysis["classScores"],
            "confidenceType": analysis["confidenceType"],
            "gradingMethod": analysis["gradingMethod"],
            "explanation": analysis["explanation"],
            "capture": capture,
            "gradeCappedByDefectCheck": analysis["gradeCappedByDefectCheck"],
            "inspectedAt": int(time.time()),
            "oracleNode": oracle_signer.address
        }

        # Cryptographic keccak256 report hash
        report_hash = oracle_signer.generate_report_hash(report)

        # Cryptographic ECDSA signature
        signature_data = oracle_signer.sign_verification(
            chain_id=chainId,
            registry_address=registryAddress,
            token_id=tokenId,
            grade=analysis["grade"],
            confidence_score=analysis["confidenceBasisPoints"],
            report_hash=report_hash
        )

        return {
            "success": True,
            "tokenId": tokenId,
            "cropType": cropType,
            "grade": analysis["grade"],
            "gradeName": analysis["gradeName"],
            "gradeLabel": analysis["gradeLabel"],
            "confidenceScore": analysis["confidenceBasisPoints"],
            "confidencePercent": analysis["confidencePercent"],
            "report": report,
            "reportHash": report_hash,
            "signature": signature_data["signature"],
            "oracleSigner": signature_data["signer"],
            "model": analysis["modelName"],
            "modelVersion": analysis["modelVersion"],
            "qualityLabel": analysis["qualityLabel"],
            "dataset": analysis["dataset"],
            "datasetVersion": analysis["datasetVersion"],
            "datasetLicense": analysis["datasetLicense"],
            "classScores": analysis["classScores"],
            "confidenceType": analysis["confidenceType"],
            "gradingMethod": analysis["gradingMethod"],
            "explanation": analysis["explanation"],
            "capture": capture,
            "gradeCappedByDefectCheck": analysis["gradeCappedByDefectCheck"]
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI verification failed: {str(e)}")

@app.post("/api/verify-json")
def reject_synthetic_verification():
    raise HTTPException(status_code=415, detail="Image upload is required; synthetic-image verification is disabled.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("AI_SERVICE_PORT", "8001")))
