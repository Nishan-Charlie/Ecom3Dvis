import subprocess
import os
import cv2


def extract_frames(job_dir: str, target: int = 50, fps: int = 2):
    frames_dir = os.path.join(job_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    subprocess.run([
        "ffmpeg", "-y",
        "-i", os.path.join(job_dir, "input.mp4"),
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(frames_dir, "frame_%04d.jpg"),
    ], check=True, capture_output=True)

    # Score each frame by sharpness (Laplacian variance), keep top `target`
    scored = []
    for fname in os.listdir(frames_dir):
        if not fname.lower().endswith(".jpg"):
            continue
        path = os.path.join(frames_dir, fname)
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        score = cv2.Laplacian(img, cv2.CV_64F).var()
        scored.append((score, path))

    scored.sort(reverse=True)
    for _, path in scored[target:]:
        os.remove(path)

    if not scored:
        raise RuntimeError("No frames could be extracted from the video.")
