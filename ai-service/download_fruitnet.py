"""Download the cited, licensed FruitNet image dataset from its public Kaggle mirror."""

import json
import os
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath

import requests


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
ARCHIVE = DATA_DIR / "fruitnet.zip"
EXTRACT_DIR = DATA_DIR / "fruitnet"
API_URL = "https://www.kaggle.com/api/v1/datasets/download/shashwatwork/fruitnet-indian-fruits-dataset-with-quality"
INFO_URL = "https://www.kaggle.com/api/v1/datasets/view/shashwatwork/fruitnet-indian-fruits-dataset-with-quality"
EXPECTED_LICENSE = "CC BY-SA 4.0"


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    info = requests.get(INFO_URL, timeout=60)
    info.raise_for_status()
    metadata = info.json()
    if metadata.get("licenseName") != EXPECTED_LICENSE:
        raise RuntimeError(f"Unexpected Kaggle mirror license: {metadata.get('licenseName')!r}")
    source = {
        "dataset": "FruitNet: Indian Fruits Dataset with quality (Good, Bad & Mixed quality)",
        "original": "https://data.mendeley.com/datasets/b6fftwbr2v/3",
        "doi": "10.17632/b6fftwbr2v.3",
        "paper": "https://doi.org/10.1016/j.dib.2021.107686",
        "mirror": "https://www.kaggle.com/datasets/shashwatwork/fruitnet-indian-fruits-dataset-with-quality",
        "mirror_license": EXPECTED_LICENSE,
        "mirror_uploader": metadata.get("creatorName"),
        "description": "Real mobile-phone fruit photos with Good, Bad, and Mixed quality labels; six fruit kinds.",
        "downloaded_at_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
    (DATA_DIR / "SOURCE.json").write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")

    if not ARCHIVE.exists():
        partial = ARCHIVE.with_suffix(".zip.part")
        if partial.exists() and zipfile.is_zipfile(partial):
            partial.replace(ARCHIVE)
        else:
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {"Range": f"bytes={offset}-"} if offset else {}
            with requests.get(API_URL, headers=headers, stream=True, timeout=(30, 120)) as response:
                if offset and response.status_code != 206:
                    offset = 0
                    partial.unlink(missing_ok=True)
                    response.close()
                    return main()
                response.raise_for_status()
                expected_archive_size = int(response.headers.get("Content-Length", "0")) + offset
                mode = "ab" if offset else "wb"
                written = offset
                with partial.open(mode) as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            output.write(chunk)
                            written += len(chunk)
                            if expected_archive_size and written % (128 * 1024 * 1024) < len(chunk):
                                print(f"Downloaded {written / expected_archive_size:.0%} ({written // (1024*1024)} MiB)", flush=True)
            if expected_archive_size and partial.stat().st_size != expected_archive_size:
                raise RuntimeError(f"Compressed archive size mismatch: {partial.stat().st_size} vs {expected_archive_size}")
            if not zipfile.is_zipfile(partial):
                raise RuntimeError("The downloaded file is not a valid ZIP archive.")
        if partial.exists():
            partial.replace(ARCHIVE)

    if not EXTRACT_DIR.exists() or not any(EXTRACT_DIR.rglob("*.jpg")):
        EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(ARCHIVE) as archive:
            for member in archive.infolist():
                relative = PurePosixPath(member.filename)
                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError(f"Unsafe path in dataset archive: {member.filename}")
            archive.extractall(EXTRACT_DIR)
    print(f"FruitNet extracted to {EXTRACT_DIR}", flush=True)


if __name__ == "__main__":
    main()
