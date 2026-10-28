import unittest
import io
from pathlib import Path
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
        self.assertTrue(data["model"].startswith("fruitnet-"))

    def test_trained_crop_quality_engine_with_real_dataset_photo(self):
        photo = Path(__file__).resolve().parents[1] / "frontend" / "public" / "crop-photos" / "apple-good.jpg"
        res = self.engine.analyze_image(photo.read_bytes())

        self.assertIn(res["grade"], [1, 2, 3])
        self.assertGreaterEqual(res["confidenceBasisPoints"], 0)
        self.assertIn(res["qualityLabel"], ["Good", "Mixed", "Bad"])
        self.assertIn("heldOutTestAccuracy", res["metrics"])
        self.assertIn("FruitNet", res["dataset"])

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

    def test_json_verification_rejects_synthetic_grade(self):
        response = self.client.post("/api/verify-json", json={"tokenId": 42})
        self.assertEqual(response.status_code, 415)
        self.assertIn("Image upload is required", response.json()["detail"])

    def test_api_verify_file_upload(self):
        photo_path = Path(__file__).resolve().parents[1] / "frontend" / "public" / "crop-photos" / "apple-good.jpg"
        photo = photo_path.read_bytes()

        response = self.client.post(
            "/api/verify",
            data={
                "tokenId": "10",
                "cropType": "Apple",
                "chainId": "31337",
                "registryAddress": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
            },
            files={"imageFile": ("apple-good.jpg", photo, "image/jpeg")}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["tokenId"], 10)
        self.assertIn(data["grade"], [1, 2, 3, 4])
        self.assertTrue(data["reportHash"].startswith("0x"))
        self.assertTrue(data["signature"].startswith("0x"))
        self.assertTrue(data["report"]["imageHash"].startswith("sha256:"))
        self.assertIn(data["qualityLabel"], ["Good", "Mixed", "Bad"])
        self.assertTrue(data["explanation"]["maskDataUrl"].startswith("data:image/jpeg;base64,"))

    def test_unsupported_crop_gets_heuristic_screening(self):
        # Grains/vegetables the CNN never trained on are screened by
        # deterministic rules — explicitly labelled, never a model grade.
        photo_path = Path(__file__).resolve().parents[1] / "frontend" / "public" / "crop-photos" / "apple-good.jpg"
        response = self.client.post(
            "/api/verify",
            data={"tokenId": "12", "cropType": "Wheat", "chainId": "31337", "registryAddress": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"},
            files={"imageFile": ("apple-good.jpg", photo_path.read_bytes(), "image/jpeg")},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["gradingMethod"], "heuristic-screening")
        self.assertIn(data["grade"], [1, 2, 3])
        self.assertLessEqual(data["confidenceScore"], 8200)
        self.assertTrue(data["signature"].startswith("0x"))

    def test_screening_separates_clean_and_dirty_grain(self):
        from model import screen_crop_image
        from PIL import ImageDraw
        import random
        rng = random.Random(11)
        clean = Image.new("RGB", (128, 128), (210, 185, 130))
        d = ImageDraw.Draw(clean)
        for _ in range(300):
            x, y = rng.randint(0, 127), rng.randint(0, 127)
            d.point((x, y), fill=(rng.randint(195, 225), rng.randint(170, 200), rng.randint(115, 145)))
        buf = io.BytesIO()
        clean.save(buf, format="JPEG", quality=90)
        good = screen_crop_image(buf.getvalue(), "Wheat")
        self.assertEqual(good["gradingMethod"], "heuristic-screening")
        self.assertEqual(good["grade"], 1)

        dirty = Image.new("RGB", (128, 128), (205, 180, 125))
        d = ImageDraw.Draw(dirty)
        for _ in range(10):
            x, y = rng.randint(0, 127), rng.randint(0, 127)
            r = rng.randint(12, 30)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(45, 30, 18))
        buf = io.BytesIO()
        dirty.save(buf, format="JPEG", quality=90)
        bad = screen_crop_image(buf.getvalue(), "Wheat")
        self.assertNotEqual(bad["grade"], 1)

    def test_invalid_image_is_rejected(self):
        response = self.client.post(
            "/api/verify",
            data={"tokenId": "10", "chainId": "31337", "registryAddress": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"},
            files={"imageFile": ("not-image.jpg", b"not an image", "image/jpeg")},
        )
        self.assertEqual(response.status_code, 400)

    def test_severe_rot_cannot_receive_grade_a(self):
        # Paint unmistakable rot onto the good-apple photo: the deterministic
        # defect floor must cap the final grade even if the model says Good.
        from PIL import ImageDraw
        import random
        rng = random.Random(7)
        photo_path = Path(__file__).resolve().parents[1] / "frontend" / "public" / "crop-photos" / "apple-good.jpg"
        img = Image.open(photo_path).convert("RGB")
        draw = ImageDraw.Draw(img)
        w, h = img.size
        for _ in range(14):
            x, y = rng.randint(0, w - 1), rng.randint(0, h - 1)
            rx, ry = rng.randint(w // 8, w // 4), rng.randint(h // 8, h // 4)
            draw.ellipse([x - rx, y - ry, x + rx, y + ry],
                         fill=(rng.randint(40, 80), rng.randint(20, 45), rng.randint(10, 25)))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        res = self.engine.analyze_image(buf.getvalue())
        self.assertNotEqual(res["grade"], 1)
        self.assertIsNotNone(res["gradeCappedByDefectCheck"])

    def test_healthy_apple_keeps_model_grade(self):
        photo_path = Path(__file__).resolve().parents[1] / "frontend" / "public" / "crop-photos" / "apple-good.jpg"
        res = self.engine.analyze_image(photo_path.read_bytes())
        self.assertIsNone(res["gradeCappedByDefectCheck"])

if __name__ == "__main__":
    unittest.main()
