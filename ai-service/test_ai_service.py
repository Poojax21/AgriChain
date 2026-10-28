import unittest
import io
from PIL import Image
from fastapi.testclient import TestClient
from model import CropQualityEngine
from oracle_signer import OracleSigner
from main import app

class TestAIService(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.engine = CropQualityEngine()
        self.signer = OracleSigner()

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "healthy")
        self.assertTrue(data["oracleAddress"].startswith("0x"))

    def test_crop_quality_engine_healthy(self):
        img = Image.new("RGB", (224, 224), color=(34, 139, 34))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        res = self.engine.analyze_image(buf.getvalue())

        self.assertIn(res["grade"], [1, 2, 3, 4])
        self.assertGreaterEqual(res["confidenceBasisPoints"], 5000)
        self.assertIn("freshnessIndex", res["metrics"])
        self.assertIn("blemishRatio", res["metrics"])
        self.assertGreater(res["metrics"]["freshnessIndex"], 0)

    def test_oracle_signer(self):
        self.assertTrue(self.signer.address.startswith("0x"))

        sample_report = {"tokenId": 1, "grade": 1, "notes": "Premium quality"}
        report_hash = self.signer.generate_report_hash(sample_report)
        self.assertTrue(report_hash.startswith("0x"))
        self.assertEqual(len(report_hash), 66)

        sig_res = self.signer.sign_verification(
            chain_id=31337,
            registry_address="0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
            token_id=1,
            grade=1,
            confidence_score=9750,
            report_hash=report_hash
        )
        self.assertTrue(sig_res["verified"])
        self.assertEqual(sig_res["signer"], self.signer.address)
        self.assertTrue(sig_res["signature"].startswith("0x"))

    def test_api_verify_json_endpoint(self):
        payload = {
            "tokenId": 42,
            "cropType": "Organic Wheat",
            "chainId": 31337,
            "registryAddress": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
            "imageCID": "QmTestImageHash123"
        }
        response = self.client.post("/api/verify-json", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["tokenId"], 42)
        self.assertIn(data["grade"], [1, 2, 3, 4])
        self.assertTrue(data["reportHash"].startswith("0x"))
        self.assertTrue(data["signature"].startswith("0x"))
        self.assertTrue(data["oracleSigner"].startswith("0x"))

    def test_api_verify_file_upload(self):
        img = Image.new("RGB", (224, 224), color=(50, 205, 50))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        buf.seek(0)

        response = self.client.post(
            "/api/verify",
            data={
                "tokenId": "10",
                "cropType": "Basmati Rice",
                "chainId": "31337",
                "registryAddress": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
            },
            files={"imageFile": ("crop.jpg", buf, "image/jpeg")}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["tokenId"], 10)
        self.assertIn(data["grade"], [1, 2, 3, 4])
        self.assertTrue(data["reportHash"].startswith("0x"))
        self.assertTrue(data["signature"].startswith("0x"))

if __name__ == "__main__":
    unittest.main()
