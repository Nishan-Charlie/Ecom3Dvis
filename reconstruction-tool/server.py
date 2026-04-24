"""
Vid2Shop3D — local reconstruction server.
Run: python server.py
Then open your Vite frontend and choose "Local GPU" in the upload wizard.
"""
import asyncio
import os

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pipeline.extract_frames import extract_frames
from pipeline.remove_bg import remove_backgrounds
from pipeline.run_colmap import run_colmap
from pipeline.run_nerf import run_nerf
from pipeline.clean_mesh import clean_mesh
from pipeline.export_glb import export_glb
from pipeline.upload_firebase import upload_to_firebase, init_firebase

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# job_id → {"status", "stage", "progress", ...}
jobs: dict = {}
# job_id → list of active WebSocket connections
ws_connections: dict[str, list[WebSocket]] = {}

WORK_DIR = os.path.join(os.path.expanduser("~"), "vid2shop_jobs")


async def broadcast(job_id: str, update: dict):
    jobs.setdefault(job_id, {}).update(update)
    dead = []
    for ws in ws_connections.get(job_id, []):
        try:
            await ws.send_json(update)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_connections[job_id].remove(ws)


async def run_pipeline(job_id: str, job_dir: str, product_name: str, seller_uid: str):
    loop = asyncio.get_event_loop()
    try:
        await broadcast(job_id, {"stage": "extracting_frames", "progress": 8})
        await loop.run_in_executor(None, extract_frames, job_dir)

        await broadcast(job_id, {"stage": "removing_background", "progress": 22})
        await loop.run_in_executor(None, remove_backgrounds, job_dir)

        await broadcast(job_id, {"stage": "estimating_cameras", "progress": 38})
        await loop.run_in_executor(None, run_colmap, job_dir)

        await broadcast(job_id, {"stage": "reconstructing", "progress": 55})
        await loop.run_in_executor(None, run_nerf, job_dir)

        await broadcast(job_id, {"stage": "cleaning_mesh", "progress": 82})
        await loop.run_in_executor(None, clean_mesh, job_dir)

        await broadcast(job_id, {"stage": "exporting", "progress": 90})
        await loop.run_in_executor(None, export_glb, job_dir)

        await broadcast(job_id, {"stage": "uploading", "progress": 95})
        glb_url = await loop.run_in_executor(
            None, upload_to_firebase, job_dir, job_id, seller_uid, product_name
        )

        await broadcast(job_id, {
            "stage": "done",
            "progress": 100,
            "glb_url": glb_url,
            "status": "done",
        })
        print(f"[{job_id}] Done — {glb_url}")

    except Exception as e:
        print(f"[{job_id}] Pipeline failed: {e}")
        await broadcast(job_id, {
            "stage": "failed",
            "progress": 0,
            "error": str(e),
            "status": "failed",
        })


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/start")
async def start_job(
    video: UploadFile = File(...),
    product_name: str = Form(...),
    seller_uid: str = Form(...),
    listing_id: str = Form(...),
):
    job_id = listing_id
    job_dir = os.path.join(WORK_DIR, job_id)

    for sub in ["frames", "frames_masked", "colmap/sparse", "nerf", "output"]:
        os.makedirs(os.path.join(job_dir, sub), exist_ok=True)

    video_path = os.path.join(job_dir, "input.mp4")
    with open(video_path, "wb") as f:
        f.write(await video.read())

    jobs[job_id] = {"status": "running", "stage": "queued", "progress": 0}
    ws_connections[job_id] = []

    asyncio.create_task(run_pipeline(job_id, job_dir, product_name, seller_uid))
    print(f"[{job_id}] Job started — video saved to {video_path}")
    return {"job_id": job_id}


@app.get("/api/job/{job_id}")
async def get_job(job_id: str):
    return jobs.get(job_id, {"error": "not found"})


@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()
    ws_connections.setdefault(job_id, []).append(websocket)

    # Send current state immediately so the UI can resume after a refresh
    if job_id in jobs:
        await websocket.send_json(jobs[job_id])

    try:
        while True:
            await asyncio.sleep(20)
            await websocket.send_json({"ping": True})
    except WebSocketDisconnect:
        if job_id in ws_connections and websocket in ws_connections[job_id]:
            ws_connections[job_id].remove(websocket)


# Serve Vite build when running as standalone (sellers don't need the dev server)
_static = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static):
    app.mount("/", StaticFiles(directory=_static, html=True), name="static")


if __name__ == "__main__":
    os.makedirs(WORK_DIR, exist_ok=True)
    init_firebase()
    print("Vid2Shop3D local server starting on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
