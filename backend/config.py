"""Local reconstruction settings (COLMAP + Open3D)."""

import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent


def _load_dotenv_file(path: Path) -> None:
    """Load KEY=VALUE lines into os.environ (does not override existing vars)."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        os.environ[key] = val


# Project-root .env (RECON_COLMAP_EXECUTABLE, etc.) — same file Vite uses at repo root.
_load_dotenv_file(_PROJECT_ROOT / ".env")
_load_dotenv_file(_BACKEND_DIR / ".env")

JOBS_ROOT = Path(os.environ.get("RECON_JOBS_ROOT", _BACKEND_DIR / "jobs")).expanduser().resolve()

# COLMAP executable (Windows: path to COLMAP.bat or colmap.exe). If empty, uses PATH.
COLMAP_EXECUTABLE = os.environ.get("RECON_COLMAP_EXECUTABLE", "").strip() or None

MAX_IMAGES = int(os.environ.get("RECON_MAX_IMAGES", "50"))
MAX_IMAGE_BYTES = int(os.environ.get("RECON_MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))

# Poisson octree depth: higher = finer mesh grid (9–11 typical; 12 is very heavy).
POISSON_DEPTH = int(os.environ.get("RECON_POISSON_DEPTH", "10"))
# Poisson surface scale (>1 fills gaps on sparse clouds; 1.1–1.3).
POISSON_SCALE = float(os.environ.get("RECON_POISSON_SCALE", "1.15"))
# Drop lowest-density vertices after Poisson (0.01 = keep more triangles than 0.05).
POISSON_DENSITY_TRIM = float(os.environ.get("RECON_POISSON_DENSITY_TRIM", "0.01"))
# Midpoint subdivisions after Poisson (0–3) — smoother, denser triangles in the viewer.
POISSON_SUBDIVIDE_ITER = int(os.environ.get("RECON_POISSON_SUBDIVIDE", "2"))

# COLMAP SIFT on GPU needs VRAM; default CPU for laptops / integrated graphics.
COLMAP_USE_GPU = os.environ.get("RECON_COLMAP_USE_GPU", "0").strip().lower() in ("1", "true", "yes")

# Video orbit: match each frame to nearby frames (better than exhaustive for ordered captures).
COLMAP_SEQUENTIAL_OVERLAP = int(os.environ.get("RECON_COLMAP_SEQ_OVERLAP", "20"))
COLMAP_LOOP_DETECTION = os.environ.get("RECON_COLMAP_LOOP_DETECTION", "1").strip().lower() in (
    "1",
    "true",
    "yes",
)

# Target point count for “normal” mesh quality; below this uses coarse mesh settings but still runs.
MIN_SPARSE_POINTS = int(os.environ.get("RECON_MIN_SPARSE_POINTS", "80"))
# Hard fail only below this (COLMAP essentially failed).
ABSOLUTE_MIN_SPARSE_POINTS = int(os.environ.get("RECON_ABSOLUTE_MIN_SPARSE_POINTS", "15"))

# After sequential matching, also run exhaustive matching on the same DB (more pairs for orbit video).
COLMAP_EXTRA_EXHAUSTIVE_MATCH = os.environ.get("RECON_COLMAP_EXTRA_EXHAUSTIVE", "1").strip().lower() in (
    "1",
    "true",
    "yes",
)
