#!/usr/bin/env python3
"""
One-time setup checker for Vid2Shop3D reconstruction tool.
Run: python setup.py
"""
import sys
import os
import shutil
import importlib

REQUIRED_PYTHON = (3, 9)

PIP_PACKAGES = [
    ("fastapi", "fastapi"),
    ("uvicorn", "uvicorn"),
    ("opencv-python", "cv2"),
    ("rembg", "rembg"),
    ("open3d", "open3d"),
    ("trimesh", "trimesh"),
    ("firebase-admin", "firebase_admin"),
    ("python-multipart", "multipart"),
    ("Pillow", "PIL"),
]

REQUIRED_BINS = ["ffmpeg", "colmap", "gltfpack"]
OPTIONAL_BINS = ["instant-ngp"]


def check_python() -> bool:
    v = sys.version_info[:2]
    if v < REQUIRED_PYTHON:
        print(f"  FAIL  Python {REQUIRED_PYTHON[0]}.{REQUIRED_PYTHON[1]}+ required (found {v[0]}.{v[1]})")
        return False
    print(f"  OK    Python {v[0]}.{v[1]}.{sys.version_info[2]}")
    return True


def check_packages() -> bool:
    all_ok = True
    missing = []
    for pip_name, import_name in PIP_PACKAGES:
        try:
            importlib.import_module(import_name)
            print(f"  OK    {pip_name}")
        except ImportError:
            print(f"  MISS  {pip_name}")
            missing.append(pip_name)
            all_ok = False
    if missing:
        print(f"\n  Install missing packages:\n  pip install {' '.join(missing)}")
        print("  Or install everything: pip install -r requirements.txt\n")
    return all_ok


def check_binaries() -> bool:
    all_ok = True
    for b in REQUIRED_BINS:
        if shutil.which(b):
            print(f"  OK    {b}")
        else:
            print(f"  MISS  {b}  (required)")
            all_ok = False
    for b in OPTIONAL_BINS:
        if shutil.which(b):
            print(f"  OK    {b}")
        else:
            print(f"  WARN  {b}  (optional — needed for NeRF reconstruction)")
    return all_ok


def check_firebase_config() -> bool:
    cfg = os.path.join(os.path.dirname(__file__), "firebase_config.json")
    if not os.path.exists(cfg):
        print("  MISS  firebase_config.json")
        print("        Download from: Firebase Console > Project Settings > Service accounts > Generate new private key")
        return False
    import json
    with open(cfg) as f:
        data = json.load(f)
    if data.get("type") == "TEMPLATE":
        print("  MISS  firebase_config.json  (still has template values)")
        print("        Replace with your real service account key JSON.")
        return False
    if data.get("type") == "service_account":
        print(f"  OK    firebase_config.json  (project: {data.get('project_id', '?')})")
        return True
    print("  WARN  firebase_config.json exists but may not be a service account key")
    return True


if __name__ == "__main__":
    print("=" * 50)
    print("  Vid2Shop3D — Setup Check")
    print("=" * 50)

    print("\nPython version:")
    py_ok = check_python()

    print("\nPython packages:")
    pkg_ok = check_packages()

    print("\nSystem binaries:")
    bin_ok = check_binaries()

    print("\nFirebase config:")
    fb_ok = check_firebase_config()

    print("\n" + "=" * 50)
    if py_ok and pkg_ok and bin_ok and fb_ok:
        print("  All checks passed!")
        print("  Start the server: python server.py")
    else:
        print("  Fix the issues above, then run: python setup.py")
        sys.exit(1)
