import subprocess
import os
import shutil


def export_glb(job_dir: str) -> str:
    in_path = os.path.join(job_dir, "output", "clean_mesh.obj")
    out_path = os.path.join(job_dir, "output", "product.glb")

    gltfpack = shutil.which("gltfpack") or "gltfpack"

    subprocess.run([
        gltfpack,
        "-i", in_path,
        "-o", out_path,
        "-cc",      # Draco mesh compression
        "-tc",      # Texture compression
        "-tq", "8", # Texture quality
    ], check=True)

    return out_path
