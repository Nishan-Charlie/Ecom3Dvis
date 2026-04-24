import subprocess
import os
import shutil


def _find_colmap2nerf() -> str:
    # Look next to this file first (sellers can drop it in pipeline/scripts/)
    local = os.path.join(os.path.dirname(__file__), "scripts", "colmap2nerf.py")
    if os.path.exists(local):
        return local

    # Common install location for instant-ngp clones
    candidates = [
        os.path.expanduser("~/instant-ngp/scripts/colmap2nerf.py"),
        os.path.expanduser("~/tools/instant-ngp/scripts/colmap2nerf.py"),
        "C:/instant-ngp/scripts/colmap2nerf.py",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c

    raise FileNotFoundError(
        "colmap2nerf.py not found. "
        "Copy it from your instant-ngp/scripts/ folder into "
        "reconstruction-tool/pipeline/scripts/colmap2nerf.py"
    )


def run_nerf(job_dir: str, n_steps: int = 5000):
    nerf_dir = os.path.join(job_dir, "nerf")
    os.makedirs(nerf_dir, exist_ok=True)

    colmap2nerf = _find_colmap2nerf()

    subprocess.run([
        "python", colmap2nerf,
        "--images", os.path.join(job_dir, "frames_masked"),
        "--run_colmap", "false",
        "--colmap_db", os.path.join(job_dir, "colmap", "colmap.db"),
        "--out", os.path.join(nerf_dir, "transforms.json"),
    ], check=True)

    instant_ngp = shutil.which("instant-ngp") or "instant-ngp"

    subprocess.run([
        instant_ngp,
        "--scene", os.path.join(nerf_dir, "transforms.json"),
        "--snapshot", os.path.join(nerf_dir, "model.msgpack"),
        "--n_steps", str(n_steps),
        "--marching_cubes_res", "256",
        "--save_mesh", os.path.join(job_dir, "output", "raw_mesh.obj"),
    ], check=True)
