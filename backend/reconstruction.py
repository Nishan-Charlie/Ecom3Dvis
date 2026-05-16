"""
Local 3D reconstruction without cloud APIs:
- single: textured billboard GLB (one image).
- multi: COLMAP sparse SfM + Open3D Poisson surface → GLB (untextured mesh).
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np
import open3d as o3d
from PIL import Image
import trimesh

import config

_COLMAP_HINT = """COLMAP executable not found (WinError 2 / file not found).
Install COLMAP, then either:
  • Add the folder that contains colmap.exe to your system PATH, or
  • Set RECON_COLMAP_EXECUTABLE to the full path of colmap.exe, e.g.
    C:\\Program Files\\COLMAP\\bin\\colmap.exe
Windows note: .bat launchers must be run via cmd; this server handles that when you point to COLMAP.bat.
Releases: https://github.com/colmap/colmap/releases
"""


def _append_log(job_dir: Path, text: str) -> None:
    log = job_dir / "pipeline.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8", errors="replace") as f:
        f.write(text)
        if not text.endswith("\n"):
            f.write("\n")


def resolve_colmap_executable() -> str | None:
    """Return absolute path to COLMAP if found; None if not configured."""
    if config.COLMAP_EXECUTABLE:
        p = Path(config.COLMAP_EXECUTABLE).expanduser()
        try:
            p = p.resolve()
        except OSError:
            return None
        return str(p) if p.is_file() else None

    for name in ("colmap.exe", "colmap", "COLMAP.bat"):
        w = shutil.which(name)
        if w:
            wp = Path(w).resolve()
            if wp.is_file():
                return str(wp)

    if os.name == "nt":
        roots: list[Path] = []
        for key in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            v = os.environ.get(key)
            if v:
                roots.append(Path(v))
        rels = (
            Path("COLMAP") / "bin" / "colmap.exe",
            Path("COLMAP") / "COLMAP.bat",
        )
        for root in roots:
            for rel in rels:
                cand = (root / rel).resolve()
                if cand.is_file():
                    return str(cand)

    return None


def require_colmap_executable() -> str:
    exe = resolve_colmap_executable()
    if exe:
        return exe
    if config.COLMAP_EXECUTABLE:
        raise RuntimeError(
            f"RECON_COLMAP_EXECUTABLE is set to {config.COLMAP_EXECUTABLE!r} but that path is not a file."
        )
    raise RuntimeError(_COLMAP_HINT)


def colmap_command_argv(colmap_exe: str, colmap_args: list[str]) -> list[str]:
    """Build argv for subprocess: Windows cannot exec .bat directly; use cmd /c."""
    if os.name == "nt" and colmap_exe.lower().endswith(".bat"):
        return ["cmd", "/c", colmap_exe, *colmap_args]
    return [colmap_exe, *colmap_args]


def colmap_subprocess_env(colmap_exe: str, base: dict[str, str] | None = None) -> dict[str, str]:
    """
    COLMAP Windows builds ship Qt in plugins/platforms; without this, feature_extractor
    crashes (exit 3221226505) with: Could not find the Qt platform plugin "windows".
    """
    env = dict(base or os.environ)
    bin_dir = Path(colmap_exe).resolve().parent
    install_root = bin_dir.parent
    platform_candidates = (
        install_root / "plugins" / "platforms",
        bin_dir / "platforms",
        install_root / "platforms",
    )
    for platforms_dir in platform_candidates:
        if (platforms_dir / "qwindows.dll").is_file():
            env["QT_QPA_PLATFORM_PLUGIN_PATH"] = str(platforms_dir)
            plugins_root = platforms_dir.parent
            if plugins_root.name == "platforms":
                env.setdefault("QT_PLUGIN_PATH", str(plugins_root.parent))
            break

    path_key = "PATH" if os.name == "nt" else "PATH"
    env[path_key] = str(bin_dir) + os.pathsep + env.get(path_key, "")
    return env


def _run(job_dir: Path, argv: list[str], cwd: Path | None = None) -> None:
    _append_log(job_dir, f"$ {' '.join(argv)}")
    program, *rest = argv
    env = colmap_subprocess_env(program)
    cmd = colmap_command_argv(program, rest)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or job_dir),
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as e:
        raise RuntimeError(
            f"Could not start {program!r}: {e}. "
            "Install COLMAP or set RECON_COLMAP_EXECUTABLE to the full path of colmap.exe."
        ) from e
    if proc.stdout:
        _append_log(job_dir, proc.stdout)
    if proc.stderr:
        _append_log(job_dir, proc.stderr)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        if "Qt platform plugin" in detail or proc.returncode == 3221226505:
            raise RuntimeError(
                "COLMAP crashed (Qt plugins). Restart npm run recon after updating the backend, "
                "or run COLMAP from its install folder. " + detail[:500]
            )
        if "Not enough GPU memory" in detail and config.COLMAP_USE_GPU:
            raise RuntimeError(
                "COLMAP ran out of GPU memory during SIFT matching. "
                "Set RECON_COLMAP_USE_GPU=0 in .env and restart npm run recon."
            )
        msg = f"Command failed (exit {proc.returncode}): {' '.join(argv)}"
        if detail:
            msg += f"\n{detail[-2000:]}"
        raise RuntimeError(msg)


def save_input_images(scene_dir: Path, image_streams: list[tuple[str, object]], log: Callable[[str], None]) -> None:
    inp = scene_dir / "input"
    inp.mkdir(parents=True, exist_ok=True)
    for i, (filename, stream) in enumerate(image_streams):
        raw = stream.read()
        if not raw:
            raise ValueError(f"Empty file: {filename}")
        if len(raw) > config.MAX_IMAGE_BYTES:
            raise ValueError(f"File too large ({len(raw)} bytes): {filename}")
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        out = inp / f"frame_{i:04d}.jpg"
        img.save(out, format="JPEG", quality=92)
        log(f"Saved {out.name} ({img.size[0]}x{img.size[1]})")


def _billboard_glb(image_path: Path, out_glb: Path) -> None:
    """Minimal textured quad in XY plane (Z forward), centered, ~1 unit tall."""
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    if not w or not h:
        raise ValueError("Invalid image dimensions")
    aspect = w / h
    height = 1.0
    width = aspect * height
    z = 0.0
    vertices = np.array(
        [
            [-width / 2, -height / 2, z],
            [width / 2, -height / 2, z],
            [width / 2, height / 2, z],
            [-width / 2, height / 2, z],
        ],
        dtype=np.float64,
    )
    faces_front = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    faces_back = np.array([[0, 2, 1], [0, 3, 2]], dtype=np.int64)
    uvs = np.array([[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]], dtype=np.float64)
    mat = trimesh.visual.texture.SimpleMaterial(image=img)
    front = trimesh.Trimesh(
        vertices=vertices,
        faces=faces_front,
        visual=trimesh.visual.TextureVisuals(uv=uvs, material=mat),
        process=False,
    )
    back = trimesh.Trimesh(
        vertices=vertices,
        faces=faces_back,
        visual=trimesh.visual.TextureVisuals(uv=uvs, material=mat),
        process=False,
    )
    trimesh.util.concatenate([front, back]).export(out_glb)


def _pick_sparse_model(sparse_root: Path) -> Path:
    if not sparse_root.is_dir():
        raise RuntimeError("COLMAP produced no sparse/ directory.")
    subdirs = [p for p in sparse_root.iterdir() if p.is_dir() and p.name.isdigit()]
    if not subdirs:
        raise RuntimeError("COLMAP mapper found no reconstruction (try more frames / better overlap).")
    def score(p: Path) -> int:
        pb = p / "points3D.bin"
        if pb.is_file():
            return pb.stat().st_size
        return 0
    return max(subdirs, key=score)


def _sparse_reconstruction_hint(n_images: int, n_points: int) -> str:
    return (
        f"COLMAP recovered only {n_points} 3D points from {n_images} images. "
        "For orbit video: move slowly around the object, keep it centered, use even lighting, "
        "30–50 sharp frames with ~60–80% overlap between neighbors, and avoid motion blur. "
        "Try Dense sampling in the frame extractor and a lower blur threshold."
    )


def _reset_colmap_workspace(job_dir: Path) -> None:
    for name in ("database.db", "sparse", "sparse_points.ply", "model.glb"):
        p = job_dir / name
        if p.is_file():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)


def _run_colmap(
    job_dir: Path,
    input_rel: str = "scene/input",
    *,
    matcher: str = "sequential",
    seq_overlap: int | None = None,
    extra_exhaustive: bool | None = None,
) -> Path:
    """Returns path to best sparse model folder (e.g. sparse/0)."""
    db = job_dir / "database.db"
    if db.exists():
        db.unlink()
    colmap = require_colmap_executable()
    image_path = (job_dir / input_rel).resolve()
    if not image_path.is_dir():
        raise RuntimeError(f"COLMAP image folder missing: {image_path}")

    n_images = len(list(image_path.glob("*.jpg"))) + len(list(image_path.glob("*.jpeg")))
    _append_log(job_dir, f"COLMAP input: {n_images} images")
    if n_images < 8:
        _append_log(
            job_dir,
            "Warning: fewer than 8 views — multi-view SfM is unreliable; use 20+ overlapping frames if possible.",
        )

    gpu = "1" if config.COLMAP_USE_GPU else "0"

    _run(
        job_dir,
        [
            colmap,
            "feature_extractor",
            "--database_path",
            str(db.resolve()),
            "--image_path",
            str(image_path),
            "--ImageReader.single_camera",
            "1",
            "--FeatureExtraction.use_gpu",
            gpu,
            "--SiftExtraction.max_num_features",
            "8192",
            "--SiftExtraction.peak_threshold",
            "0.004",
        ],
    )
    overlap = seq_overlap if seq_overlap is not None else config.COLMAP_SEQUENTIAL_OVERLAP
    add_exhaustive = (
        config.COLMAP_EXTRA_EXHAUSTIVE_MATCH if extra_exhaustive is None else extra_exhaustive
    )

    if matcher == "sequential":
        loop = "1" if config.COLMAP_LOOP_DETECTION else "0"
        _append_log(job_dir, f"COLMAP matching: sequential (overlap={overlap}, loop={loop})")
        _run(
            job_dir,
            [
                colmap,
                "sequential_matcher",
                "--database_path",
                str(db.resolve()),
                "--FeatureMatching.use_gpu",
                gpu,
                "--SequentialMatching.overlap",
                str(overlap),
                "--SequentialMatching.quadratic_overlap",
                "1",
                "--SequentialMatching.loop_detection",
                loop,
            ],
        )
        if add_exhaustive:
            _append_log(job_dir, "COLMAP matching: + exhaustive (extra image pairs)")
            _run(
                job_dir,
                [
                    colmap,
                    "exhaustive_matcher",
                    "--database_path",
                    str(db.resolve()),
                    "--FeatureMatching.use_gpu",
                    gpu,
                ],
            )
    elif matcher == "exhaustive":
        _append_log(job_dir, "COLMAP matching: exhaustive (all pairs)")
        _run(
            job_dir,
            [
                colmap,
                "exhaustive_matcher",
                "--database_path",
                str(db.resolve()),
                "--FeatureMatching.use_gpu",
                gpu,
            ],
        )
    else:
        raise ValueError(f"Unknown matcher: {matcher}")
    return _run_mapper_with_retries(
        job_dir, colmap, db, image_path, n_images=n_images
    )


def _mapper_argv(
    colmap: str,
    db: Path,
    image_path: Path,
    sparse: Path,
    n_images: int,
    *,
    profile: str,
) -> list[str]:
    """COLMAP mapper CLI args; profiles relax init when orbit video fails default init."""
    init_inliers = str(max(8, min(25, n_images // 3)))
    abs_inliers = str(max(8, min(20, n_images // 4)))
    argv: list[str] = [
        colmap,
        "mapper",
        "--database_path",
        str(db.resolve()),
        "--image_path",
        str(image_path),
        "--output_path",
        str(sparse.resolve()),
        "--Mapper.multiple_models",
        "1",
        "--Mapper.max_num_models",
        "3",
        "--Mapper.min_num_matches",
        "6",
        "--Mapper.init_min_num_inliers",
        init_inliers,
        "--Mapper.abs_pose_min_num_inliers",
        abs_inliers,
        "--Mapper.tri_min_angle",
        "1.0",
        "--Mapper.filter_min_tri_angle",
        "1.0",
    ]
    if profile == "default":
        argv += [
            "--Mapper.init_max_error",
            "8",
            "--Mapper.init_max_forward_motion",
            "0.99",
            "--Mapper.init_min_tri_angle",
            "4",
            "--Mapper.init_num_trials",
            "300",
            "--Mapper.abs_pose_max_error",
            "16",
            "--Mapper.abs_pose_min_inlier_ratio",
            "0.2",
        ]
    elif profile == "relaxed":
        argv += [
            "--Mapper.init_max_error",
            "12",
            "--Mapper.init_max_forward_motion",
            "1.0",
            "--Mapper.init_min_tri_angle",
            "2",
            "--Mapper.init_num_trials",
            "500",
            "--Mapper.abs_pose_max_error",
            "20",
            "--Mapper.abs_pose_min_inlier_ratio",
            "0.12",
            "--Mapper.init_min_num_inliers",
            "8",
            "--Mapper.abs_pose_min_num_inliers",
            "8",
        ]
    elif profile == "adjacent":
        # Force first two images in DB order (frame_0000, frame_0001 when names are zero-padded).
        argv += [
            "--Mapper.init_image_id1",
            "1",
            "--Mapper.init_image_id2",
            "2",
            "--Mapper.init_max_error",
            "12",
            "--Mapper.init_max_forward_motion",
            "1.0",
            "--Mapper.init_min_tri_angle",
            "2",
            "--Mapper.init_num_trials",
            "200",
            "--Mapper.abs_pose_max_error",
            "20",
            "--Mapper.abs_pose_min_inlier_ratio",
            "0.1",
            "--Mapper.init_min_num_inliers",
            "6",
            "--Mapper.abs_pose_min_num_inliers",
            "6",
        ]
    else:
        raise ValueError(f"Unknown mapper profile: {profile}")
    return argv


def _run_mapper_with_retries(
    job_dir: Path,
    colmap: str,
    db: Path,
    image_path: Path,
    *,
    n_images: int,
) -> Path:
    sparse = job_dir / "sparse"
    profiles = ("default", "relaxed", "adjacent")
    last_err: RuntimeError | None = None

    for profile in profiles:
        if sparse.exists():
            shutil.rmtree(sparse)
        sparse.mkdir(parents=True)
        _append_log(job_dir, f"COLMAP mapper (profile={profile})")
        try:
            _run(job_dir, _mapper_argv(colmap, db, image_path, sparse, n_images, profile=profile))
            return _pick_sparse_model(sparse)
        except RuntimeError as e:
            last_err = e
            msg = str(e).lower()
            if "failed to create any sparse model" not in msg and "no sparse" not in msg:
                raise
            _append_log(job_dir, f"Mapper profile '{profile}' failed, trying next…")

    raise last_err or RuntimeError("COLMAP mapper failed for all profiles.")


def _sparse_to_pointcloud_ply(job_dir: Path, model_dir: Path, ply_out: Path) -> None:
    colmap = require_colmap_executable()
    _run(
        job_dir,
        [
            colmap,
            "model_converter",
            "--input_path",
            str(model_dir),
            "--output_path",
            str(ply_out),
            "--output_type",
            "PLY",
        ],
    )
    if not ply_out.is_file():
        raise RuntimeError("COLMAP model_converter did not write a PLY file.")


def _count_input_images(job_dir: Path | None) -> int:
    if not job_dir:
        return 0
    inp = job_dir / "scene" / "input"
    if not inp.is_dir():
        return 0
    return len(list(inp.glob("*.jpg"))) + len(list(inp.glob("*.jpeg")))


def _mesh_from_point_cloud(pcd: o3d.geometry.PointCloud, *, coarse: bool) -> o3d.geometry.TriangleMesh:
    work = pcd
    n = len(work.points)
    if not coarse and n >= 200:
        work, _ = work.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    elif not coarse and n >= 80:
        work, _ = work.remove_statistical_outlier(nb_neighbors=12, std_ratio=2.5)

    bbox = work.get_axis_aligned_bounding_box()
    diag = float(np.linalg.norm(bbox.get_extent()))
    if diag <= 1e-8:
        raise RuntimeError("Degenerate point cloud (zero extent).")
    radius = max(diag * (0.04 if coarse else 0.02), 1e-4)
    max_nn = 20 if coarse else 30
    work.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=radius, max_nn=max_nn),
    )
    cam = np.array([0.0, 0.0, max(diag * 2.0, 0.5)], dtype=np.float64)
    work.orient_normals_towards_camera_location(cam)

    depth = max(6, config.POISSON_DEPTH - 1) if coarse else config.POISSON_DEPTH
    scale = max(1.05, config.POISSON_SCALE + (0.1 if coarse else 0.0))
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        work,
        depth=depth,
        width=0,
        scale=scale,
        linear_fit=False,
    )
    densities = np.asarray(densities)
    trim = config.POISSON_DENSITY_TRIM
    if densities.size and trim > 0:
        thr = np.quantile(densities, trim)
        mesh.remove_vertices_by_mask(densities < thr)

    subdiv = config.POISSON_SUBDIVIDE_ITER
    if subdiv > 0 and len(mesh.vertices) > 0:
        cap = 250_000
        for _ in range(subdiv):
            if len(mesh.vertices) >= cap:
                break
            mesh = mesh.subdivide_midpoint(number_of_iterations=1)

    if len(mesh.vertices) < 50:
        dists = np.asarray(work.compute_nearest_neighbor_distance())
        if dists.size:
            alpha = float(np.mean(dists)) * 3.0
            try:
                mesh = o3d.geometry.TriangleMesh.create_from_point_cloud_alpha_shape(work, alpha)
            except Exception:
                pass
    mesh.compute_vertex_normals()
    return mesh


def _poisson_mesh_glb(ply_path: Path, glb_out: Path, job_dir: Path | None = None) -> None:
    pcd = o3d.io.read_point_cloud(str(ply_path))
    n0 = len(pcd.points)
    if job_dir:
        _append_log(job_dir, f"Sparse point cloud: {n0} points")

    if n0 < config.ABSOLUTE_MIN_SPARSE_POINTS:
        raise RuntimeError(_sparse_reconstruction_hint(_count_input_images(job_dir), n0))

    coarse = n0 < config.MIN_SPARSE_POINTS
    if coarse and job_dir:
        _append_log(
            job_dir,
            f"Coarse mesh mode ({n0} < {config.MIN_SPARSE_POINTS} points). "
            "Use a slower orbit and 30+ sharp frames for better quality.",
        )

    mesh = _mesh_from_point_cloud(pcd, coarse=coarse)
    if job_dir:
        _append_log(
            job_dir,
            f"Mesh: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles "
            f"(Poisson depth={config.POISSON_DEPTH}, subdivide={config.POISSON_SUBDIVIDE_ITER})",
        )
    if len(mesh.vertices) < 10:
        raise RuntimeError(
            f"Meshing produced too few vertices ({len(mesh.vertices)}). "
            + _sparse_reconstruction_hint(_count_input_images(job_dir), n0)
        )

    ok = o3d.io.write_triangle_mesh(str(glb_out), mesh, write_triangle_uvs=False)
    if not ok:
        raise RuntimeError("Open3D failed to write GLB.")


def assert_valid_glb(glb_path: Path) -> None:
    """Fail the job before returning if the mesh file is missing or not a binary glTF."""
    if not glb_path.is_file():
        raise RuntimeError(f"GLB missing at {glb_path}")
    size = glb_path.stat().st_size
    if size < 20:
        raise RuntimeError(f"GLB too small ({size} bytes); pipeline produced an empty or invalid file.")
    with glb_path.open("rb") as f:
        magic = f.read(4)
    if magic != b"glTF":
        raise RuntimeError("Output is not a valid binary GLB (expected glTF magic bytes).")


def prepare_job_workspace(job_id: str) -> Path:
    root = config.JOBS_ROOT / job_id
    if root.exists():
        shutil.rmtree(root)
    (root / "scene" / "input").mkdir(parents=True)
    return root


def run_single_image_job(job_dir: Path) -> dict:
    inp = job_dir / "scene" / "input"
    files = sorted(inp.glob("*.jpg"))
    if not files:
        raise RuntimeError("No input images.")
    out = job_dir / "model.glb"
    _billboard_glb(files[0], out)
    assert_valid_glb(out)
    _append_log(job_dir, f"Wrote billboard GLB: {out}")
    return {"mesh_glb": str(out.resolve())}


def run_multiview_job(job_dir: Path) -> dict:
    inp = job_dir / "scene" / "input"
    jpgs = sorted(inp.glob("*.jpg"))
    if len(jpgs) < 2:
        raise RuntimeError("Multi-view reconstruction needs at least 2 images.")

    def _build_mesh(
        matcher: str,
        *,
        seq_overlap: int | None = None,
        extra_exhaustive: bool | None = None,
    ) -> Path:
        model_dir = _run_colmap(
            job_dir,
            input_rel="scene/input",
            matcher=matcher,
            seq_overlap=seq_overlap,
            extra_exhaustive=extra_exhaustive,
        )
        ply = job_dir / "sparse_points.ply"
        _sparse_to_pointcloud_ply(job_dir, model_dir, ply)
        out = job_dir / "model.glb"
        _poisson_mesh_glb(ply, out, job_dir=job_dir)
        return out

    def _retryable(err: RuntimeError) -> bool:
        msg = str(err).lower()
        return any(
            k in msg
            for k in (
                "sparse",
                "mapper",
                "point cloud",
                "vertices",
                "reconstruction",
                "matches",
                "colmap recovered",
                "degenerate",
            )
        )

    attempts: list[tuple[str, dict]] = [
        ("sequential + extra pairs", {"matcher": "sequential", "extra_exhaustive": True}),
        ("exhaustive", {"matcher": "exhaustive", "extra_exhaustive": False}),
        ("sequential (high overlap)", {"matcher": "sequential", "seq_overlap": 30, "extra_exhaustive": True}),
    ]

    last_err: RuntimeError | None = None
    out: Path | None = None
    for label, kwargs in attempts:
        try:
            if last_err is not None:
                _append_log(job_dir, f"Retrying COLMAP: {label}")
                _reset_colmap_workspace(job_dir)
            else:
                _append_log(job_dir, f"COLMAP pass: {label}")
            out = _build_mesh(**kwargs)
            break
        except RuntimeError as e:
            last_err = e
            if not _retryable(e):
                raise

    if out is None:
        raise last_err or RuntimeError("Multi-view reconstruction failed.")

    assert_valid_glb(out)
    _append_log(job_dir, f"Wrote mesh GLB: {out}")
    return {"mesh_glb": str(out.resolve())}
