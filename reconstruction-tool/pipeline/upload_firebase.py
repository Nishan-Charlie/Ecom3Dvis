import os
import json
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, storage, firestore

_initialized = False


def init_firebase():
    global _initialized
    if _initialized:
        return

    config_path = os.path.join(os.path.dirname(__file__), "..", "firebase_config.json")
    if not os.path.exists(config_path):
        raise FileNotFoundError(
            "firebase_config.json not found. "
            "Download your service account key from Firebase Console > "
            "Project Settings > Service accounts > Generate new private key"
        )

    with open(config_path) as f:
        config = json.load(f)

    if config.get("type") == "TEMPLATE":
        raise ValueError(
            "firebase_config.json still contains template values. "
            "Replace it with your real service account key JSON."
        )

    storage_bucket = config.get("storageBucket") or f"{config['project_id']}.firebasestorage.app"

    cred = credentials.Certificate(config_path)
    firebase_admin.initialize_app(cred, {"storageBucket": storage_bucket})
    _initialized = True


def upload_to_firebase(job_dir: str, job_id: str, seller_uid: str, product_name: str) -> str:
    init_firebase()

    glb_path = os.path.join(job_dir, "output", "product.glb")
    if not os.path.exists(glb_path):
        raise FileNotFoundError(f"GLB not found at {glb_path}")

    bucket = storage.bucket()
    blob = bucket.blob(f"products/{seller_uid}/{job_id}/product.glb")
    blob.upload_from_filename(glb_path, content_type="model/gltf-binary")
    blob.make_public()
    glb_url = blob.public_url

    db = firestore.client()
    now = datetime.now(timezone.utc).isoformat()

    db.collection("listings").document(job_id).update({
        "modelUrl": glb_url,
        "status": "ready",
        "reconstructionMethod": "local_gpu",
        "completedAt": now,
    })

    return glb_url
