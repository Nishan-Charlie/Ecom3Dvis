#!/usr/bin/env python3
"""
Example: server-side GLB upload to Firebase Storage + Firestore status update.

Use when your 3D pipeline runs on a backend (not the browser):
  1. Generate model.glb on disk (your COLMAP / GS / NeRF export step).
  2. Upload to Storage at listings/<listingId>/model.glb
  3. Update Firestore document listings/<listingId> with modelUrl + status.

Setup:
  pip install firebase-admin
  set GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\serviceAccount.json
  (Or use firebase_admin.credentials.Certificate("path.json") below.)

This script is a template — fill BUCKET, PROJECT_ID, and paths for your environment.
"""
from __future__ import annotations

import sys
from pathlib import Path

# pip install firebase-admin
import firebase_admin
from firebase_admin import credentials, storage, firestore


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python server_upload_glb.py <listingId> <path-to-model.glb>")
        sys.exit(1)
    listing_id = sys.argv[1]
    glb_path = Path(sys.argv[2])
    if not glb_path.is_file():
        print(f"Not a file: {glb_path}")
        sys.exit(1)
    data = glb_path.read_bytes()[:4]
    if data != b"glTF":
        print("Warning: file does not start with glTF magic; may not be a valid GLB.")

    # --- configure once ---
    bucket_name = "YOUR_PROJECT.appspot.com"  # or *.firebasestorage.app
    # cred = credentials.Certificate("serviceAccount.json")
    # firebase_admin.initialize_app(cred, {"storageBucket": f"gs://{bucket_name}"})
    firebase_admin.initialize_app(options={"storageBucket": f"gs://{bucket_name}"})

    dest = f"listings/{listing_id}/model.glb"
    blob = storage.bucket().blob(dest)
    blob.upload_from_filename(str(glb_path), content_type="model/gltf-binary")
    blob.make_public()  # optional; prefer signed URLs or Storage rules instead

    url = blob.public_url  # or blob.generate_signed_url(...) for private buckets

    db = firestore.client()
    db.collection("listings").document(listing_id).update(
        {
            "modelUrl": url,
            "status": "ready",
        }
    )
    print("Uploaded and Firestore updated:", url)


if __name__ == "__main__":
    main()
