import os
import open3d as o3d


def clean_mesh(job_dir: str, target_triangles: int = 50_000):
    in_path = os.path.join(job_dir, "output", "raw_mesh.obj")
    out_path = os.path.join(job_dir, "output", "clean_mesh.obj")

    mesh = o3d.io.read_triangle_mesh(in_path)

    if not mesh.has_triangles():
        raise RuntimeError("Mesh from NeRF is empty — reconstruction may have failed.")

    mesh.remove_duplicated_vertices()
    mesh.remove_degenerate_triangles()
    mesh.remove_non_manifold_edges()
    mesh.compute_vertex_normals()

    if len(mesh.triangles) > target_triangles:
        mesh = mesh.simplify_quadric_decimation(target_triangles)

    o3d.io.write_triangle_mesh(out_path, mesh)
