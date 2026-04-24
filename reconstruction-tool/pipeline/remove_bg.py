import os
import io
from rembg import remove, new_session
from PIL import Image


def remove_backgrounds(job_dir: str):
    in_dir = os.path.join(job_dir, "frames")
    out_dir = os.path.join(job_dir, "frames_masked")
    os.makedirs(out_dir, exist_ok=True)

    session = new_session("u2net")
    fnames = sorted(f for f in os.listdir(in_dir) if f.lower().endswith((".jpg", ".jpeg", ".png")))

    if not fnames:
        raise RuntimeError("No frames found for background removal.")

    for fname in fnames:
        with open(os.path.join(in_dir, fname), "rb") as f:
            result = remove(f.read(), session=session)
        img = Image.open(io.BytesIO(result)).convert("RGBA")
        out_name = os.path.splitext(fname)[0] + ".png"
        img.save(os.path.join(out_dir, out_name))
