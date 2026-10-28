import os
import io
import time
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from model import CropQualityEngine
from oracle_signer import OracleSigner

load_dotenv("../.env")

app = FastAPI(
    title="AgriChain AI Quality Verification Microservice",
    description="Automated crop quality classification, inspection report generation, and cryptographic Oracle signing.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize singletons
quality_engine = CropQualityEngine()
oracle_signer = OracleSigner()

class VerificationRequest(BaseModel):
    tokenId: int
    cropType: Optional[str] = "Agricultural Produce"
    chainId: Optional[int] = 31337
    registryAddress: Optional[str] = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
    imageCID: Optional[str] = "QmSampleCropImageCID"

@app.get("/")
def root():
    return {
        "service": "AgriChain AI Crop Quality Verification Oracle",
        "status": "online",
        "oracleNodeAddress": oracle_signer.address,
        "model": "MobileNetV2 + HSV Defect Segmentation",
        "version": "1.0.0"
    }

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "oracleAddress": oracle_signer.address,
        "timestamp": int(time.time())
    }

@app.post("/api/verify")
async def verify_crop_batch(
    tokenId: int = Form(...),
    cropType: str = Form("Basmati Rice"),
    chainId: int = Form(31337),
    registryAddress: str = Form("0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"),
    imageFile: Optional[UploadFile] = File(None),
    imageCID: Optional[str] = Form("QmDefaultCropCID")
):
    """
    Evaluates crop inspection photographs and returns an on-chain signable verification package.
    """
    try:
        # Read image bytes if provided, else use synthetic sample
        if imageFile:
            image_bytes = await imageFile.read()
        else:
            # Generate synthetic healthy sample image bytes
            from PIL import Image
            img = Image.new("RGB", (224, 224), color=(46, 139, 87))
            buf = io.BytesIO()
            img.save(buf, format="JPEG")
            image_bytes = buf.getvalue()

        # Run AI grading
        analysis = quality_engine.analyze_image(image_bytes)

        # Generate canonical inspection report
        report = {
            "tokenId": tokenId,
            "cropType": cropType,
            "imageCID": imageCID,
            "grade": analysis["grade"],
            "gradeName": analysis["gradeName"],
            "confidenceBasisPoints": analysis["confidenceBasisPoints"],
            "metrics": analysis["metrics"],
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
            "oracleSigner": signature_data["signer"]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI verification failed: {str(e)}")

@app.post("/api/verify-json")
def verify_crop_batch_json(request: VerificationRequest):
    """
    JSON endpoint for automated server-to-server or simulated test calls.
    """
    from PIL import Image
    img = Image.new("RGB", (224, 224), color=(34, 139, 34))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    image_bytes = buf.getvalue()

    analysis = quality_engine.analyze_image(image_bytes)
    report = {
        "tokenId": request.tokenId,
        "cropType": request.cropType,
        "imageCID": request.imageCID,
        "grade": analysis["grade"],
        "gradeName": analysis["gradeName"],
        "confidenceBasisPoints": analysis["confidenceBasisPoints"],
        "metrics": analysis["metrics"],
        "inspectedAt": int(time.time()),
        "oracleNode": oracle_signer.address
    }
    report_hash = oracle_signer.generate_report_hash(report)
    sig_data = oracle_signer.sign_verification(
        chain_id=request.chainId,
        registry_address=request.registryAddress,
        token_id=request.tokenId,
        grade=analysis["grade"],
        confidence_score=analysis["confidenceBasisPoints"],
        report_hash=report_hash
    )

    return {
        "success": True,
        "tokenId": request.tokenId,
        "grade": analysis["grade"],
        "gradeName": analysis["gradeName"],
        "confidenceScore": analysis["confidenceBasisPoints"],
        "report": report,
        "reportHash": report_hash,
        "signature": sig_data["signature"],
        "oracleSigner": sig_data["signer"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
