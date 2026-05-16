"""
Flask API for local 3D reconstruction (no Replicate).

POST /api/v1/jobs — multipart: field "mode" = single | multi, field "images" (one or more files)
GET  /api/v1/jobs/<job_id>
GET  /api/v1/jobs/<job_id>/model.glb
GET  /api/v1/jobs/<job_id>/log

Run: pip install -r requirements.txt && python app.py
Multi-view needs COLMAP on PATH or set RECON_COLMAP_EXECUTABLE.
"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

import config
import reconstruction as recon

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

_jobs_lock = threading.Lock()
_jobs: dict[str, dict] = {}


def _allowed_name(name: str) -> bool:
    return bool(name) and Path(name).suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")


def _colmap_available() -> bool:
    exe = recon.resolve_colmap_executable()
    if not exe:
        return False
    cmd = recon.colmap_command_argv(exe, ["-h"])
    env = recon.colmap_subprocess_env(exe)
    try:
        r = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        return r.returncode == 0 or "COLMAP" in (r.stdout or "") or "COLMAP" in (r.stderr or "")
    except (OSError, subprocess.TimeoutExpired):
        return False


@app.get("/api/v1/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "colmap_available": _colmap_available(),
            "colmap_executable": recon.resolve_colmap_executable(),
            "jobs_root": str(config.JOBS_ROOT),
        }
    )


@app.post("/api/v1/jobs")
def create_job():
    if "images" not in request.files:
        return jsonify({"error": 'Missing multipart field "images" (one or more files).'}), 400

    mode = (request.form.get("mode") or "multi").strip().lower()
    if mode not in ("single", "multi"):
        return jsonify({"error": 'Invalid "mode"; use single or multi.'}), 400

    files = request.files.getlist("images")
    # Read bodies here: request file streams are not safe to read from a background thread after the response.
    image_payloads: list[tuple[str, bytes]] = []
    for f in files:
        if not f or not f.filename:
            continue
        if not _allowed_name(f.filename):
            return jsonify({"error": f"Unsupported or empty filename: {f.filename}"}), 400
        raw = f.read()
        if not raw:
            return jsonify({"error": f"Empty upload: {f.filename}"}), 400
        if len(raw) > config.MAX_IMAGE_BYTES:
            return jsonify({"error": f"File too large: {f.filename}"}), 400
        image_payloads.append((f.filename, raw))

    if not image_payloads:
        return jsonify({"error": "No image files received."}), 400
    if len(image_payloads) > config.MAX_IMAGES:
        return jsonify({"error": f"Too many images (max {config.MAX_IMAGES})."}), 400
    if mode == "single" and len(image_payloads) != 1:
        return jsonify({"error": 'Mode "single" requires exactly one image.'}), 400
    if mode == "multi" and len(image_payloads) < 2:
        return jsonify({"error": 'Mode "multi" requires at least two images.'}), 400
    if mode == "multi" and not recon.resolve_colmap_executable():
        return jsonify(
            {
                "error": "COLMAP is not installed or not found on this machine (WinError 2).",
                "hint": (
                    "Install COLMAP from https://github.com/colmap/colmap/releases, add "
                    "colmap.exe to PATH, or set RECON_COLMAP_EXECUTABLE to the full path "
                    "to colmap.exe (e.g. C:\\Program Files\\COLMAP\\bin\\colmap.exe)."
                ),
            }
        ), 503

    job_id = uuid.uuid4().hex
    job_dir = recon.prepare_job_workspace(job_id)

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "queued",
            "error": None,
            "result": None,
            "job_dir": str(job_dir),
            "mode": mode,
        }

    def worker() -> None:
        def set_state(**kwargs: object) -> None:
            with _jobs_lock:
                _jobs[job_id].update(kwargs)

        try:
            set_state(status="preparing")
            streams = [(name, io.BytesIO(data)) for name, data in image_payloads]
            recon.save_input_images(
                job_dir / "scene",
                streams,
                lambda m: recon._append_log(job_dir, m),
            )
            set_state(status="running")
            if mode == "single":
                result = recon.run_single_image_job(job_dir)
            else:
                result = recon.run_multiview_job(job_dir)
            set_state(status="succeeded", result=result, error=None)
        except Exception as e:  # noqa: BLE001
            recon._append_log(job_dir, f"ERROR: {e!r}")
            set_state(status="failed", error=str(e), result=None)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "status": "queued", "mode": mode}), 202


@app.get("/api/v1/jobs/<job_id>")
def get_job(job_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "Invalid job_id."}), 400
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        return jsonify({"error": "Unknown job_id."}), 404
    return jsonify(
        {
            "job_id": job_id,
            "status": job["status"],
            "error": job["error"],
            "result": job["result"],
            "mode": job.get("mode"),
        }
    )


@app.get("/api/v1/jobs/<job_id>/model.glb")
def download_glb(job_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "Invalid job_id."}), 400
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job or job["status"] != "succeeded" or not job["result"]:
        return jsonify({"error": "Job not ready or missing result."}), 404
    glb = Path(job["result"]["mesh_glb"])
    if not glb.is_file():
        return jsonify({"error": "GLB file missing on disk."}), 404
    try:
        recon.assert_valid_glb(glb)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return send_file(glb, as_attachment=True, download_name=f"{job_id}_model.glb")


@app.delete("/api/v1/jobs/<job_id>")
def delete_job(job_id: str):
    """Remove workspace on disk (in-memory job entry is kept until server restart)."""
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "Invalid job_id."}), 400
    root = config.JOBS_ROOT / job_id
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)
    return jsonify({"ok": True})


@app.get("/api/v1/jobs/<job_id>/log")
def download_log(job_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "Invalid job_id."}), 400
    log_path = config.JOBS_ROOT / job_id / "pipeline.log"
    if not log_path.is_file():
        return jsonify({"error": "No log yet."}), 404
    return send_file(log_path, as_attachment=True, download_name=f"{job_id}_pipeline.log")


def main() -> None:
    import os

    config.JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5050")), debug=False, threaded=True)


if __name__ == "__main__":
    main()
