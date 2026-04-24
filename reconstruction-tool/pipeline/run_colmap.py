import subprocess
import os


def run_colmap(job_dir: str):
    db = os.path.join(job_dir, "colmap", "colmap.db")
    images = os.path.join(job_dir, "frames_masked")
    sparse = os.path.join(job_dir, "colmap", "sparse")
    os.makedirs(sparse, exist_ok=True)

    subprocess.run([
        "colmap", "feature_extractor",
        "--database_path", db,
        "--image_path", images,
        "--SiftExtraction.max_image_size", "1280",
        "--SiftExtraction.use_gpu", "1",
    ], check=True)

    subprocess.run([
        "colmap", "exhaustive_matcher",
        "--database_path", db,
    ], check=True)

    subprocess.run([
        "colmap", "mapper",
        "--database_path", db,
        "--image_path", images,
        "--output_path", sparse,
    ], check=True)

    # sparse/0 must exist — if COLMAP found no reconstruction the frames lack overlap
    if not os.path.isdir(os.path.join(sparse, "0")):
        raise RuntimeError(
            "COLMAP found no reconstruction. "
            "Try filming slower with more overlap between frames, "
            "or use better lighting."
        )
