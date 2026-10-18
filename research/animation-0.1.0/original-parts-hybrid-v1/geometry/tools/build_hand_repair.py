"""Only the selected source-derived hand-root CDT repair; original soles remain open."""

from pathlib import Path
import json, subprocess
import numpy as np
from scipy.spatial import cKDTree
from numpy.polynomial import Chebyshev
from split_glb import GLB, partition, topology, SOURCE_SHA, digest


def inside(points, poly):
    x, y = points.T
    result = np.zeros(len(points), bool)
    for a, b in zip(poly, np.roll(poly, -1, axis=0)):
        result ^= ((a[1] > y) != (b[1] > y)) & (
            x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] + 1e-300) + a[0]
        )
    return result


def build(source, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    g = GLB(source)
    if digest(g.raw) != SOURCE_SHA:
        raise ValueError("Unapproved source SHA256")
    parts, source_attrs, source_tri = partition(
        g, 6, 0, {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 0, 6: 0}
    )
    body = parts[0]
    pos = body["attributes"]["POSITION"]
    tri = body["triangles"]
    q = pos[tri].mean(1)
    remove = np.zeros(len(tri), bool)
    for side in [-1, 1]:
        x, y, z = q.T
        phi = np.arctan2(z / 0.785, side * x)
        remove |= (side * x > 0.6) & (
            ((phi + 0.07) / 0.45) ** 2 + ((y - 0.67) / 0.27) ** 2 < 1
        )
    tri = tri[~remove]
    loops = [
        loop
        for loop in topology(pos, tri)["boundary_loops"]
        if pos[loop, 1].mean() > 0.4
    ]
    x, y, z = source_attrs["POSITION"].T
    r = (abs(x) ** 2.12 + abs(z / 0.785) ** 2.12) ** (1 / 2.12)
    bins = np.linspace(0.35, 1.05, 100)
    hs = []
    rs = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (y >= lo) & (y < hi) & (abs(x) < 0.72) & (abs(z) > 0.3)
        if mask.any():
            hs.append((lo + hi) / 2)
            rs.append(float(np.median(r[mask])))
    profile = Chebyshev.fit(hs, rs, 8)
    requests = []
    for loop in loops:
        uv = pos[loop][:, [2, 1]].astype(float)
        step = 0.034
        xx, yy = np.meshgrid(
            np.arange(uv[:, 0].min() + step, uv[:, 0].max(), step),
            np.arange(uv[:, 1].min() + step, uv[:, 1].max(), step),
        )
        grid = np.c_[xx.ravel(), yy.ravel()]
        grid = grid[inside(grid, uv)]
        grid = grid[cKDTree(uv).query(grid)[0] > step * 0.2]
        requests.append(
            {"vertices": np.r_[uv, grid].tolist(), "boundary_count": len(loop)}
        )
    inp = out / "cdt-input.json"
    result = out / "cdt-output.json"
    inp.write_text(json.dumps(requests))
    subprocess.run(
        [
            "blender",
            "-b",
            "--python",
            str(Path(__file__).with_name("cdt_worker.py")),
            "--",
            str(inp.resolve()),
            str(result.resolve()),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    patches = json.loads(result.read_text())
    attrs = {k: [v.copy()] for k, v in body["attributes"].items()}
    faces = [tri]
    total = len(pos)
    patch_reports = []
    for patch, loop, request in zip(patches, loops, requests):
        uv = np.array(patch["vertices"])
        f = np.array(patch["faces"], dtype=np.int64)
        boundary = pos[loop]
        poly = np.array(request["vertices"][: len(loop)])
        area = np.sum(
            poly[:, 0] * np.roll(poly[:, 1], -1) - poly[:, 1] * np.roll(poly[:, 0], -1)
        )
        aa = uv[f[:, 1]] - uv[f[:, 0]]
        bb = uv[f[:, 2]] - uv[f[:, 0]]
        signed = aa[:, 0] * bb[:, 1] - aa[:, 1] * bb[:, 0]
        if np.any(signed <= 0):
            raise ValueError("Nonpositive CDT projected area")
        if area > 0:
            f = f[:, [0, 2, 1]]
        remap = []
        new = []
        for i, originals in enumerate(patch["original_vertices"]):
            bids = [j for j in originals if j < len(loop)]
            if len(bids) > 1:
                raise ValueError("Merged boundary vertices")
            if bids:
                remap.append(loop[bids[0]])
            else:
                remap.append(total + len(new))
                new.append(i)
        new = np.array(new, dtype=int)
        u = uv[new]
        p = np.zeros((len(u), 3))
        p[:, [2, 1]] = u
        side = np.sign(boundary[:, 0].mean())
        rad = profile(u[:, 1])
        p[:, 0] = side * np.maximum(rad**2.12 - abs(u[:, 0] / 0.785) ** 2.12, 0) ** (
            1 / 2.12
        )
        br = profile(poly[:, 1])
        ideal = side * np.maximum(br**2.12 - abs(poly[:, 0] / 0.785) ** 2.12, 0) ** (
            1 / 2.12
        )
        dist, ix = cKDTree(poly).query(u)
        p[:, 0] += (boundary[:, 0] - ideal)[ix] * np.exp(-((dist / 0.035) ** 2))
        for key, v in body["attributes"].items():
            nearest = cKDTree(poly).query(u)[1]
            value = v[np.array(loop)[nearest]].copy()
            if key == "POSITION":
                value = p.astype(v.dtype)
            attrs[key].append(value)
        faces.append(np.array(remap)[f])
        total += len(new)
        patch_reports.append(
            {
                "region": "hand",
                "side": float(side),
                "boundary_vertices": len(loop),
                "new_vertices": len(new),
                "triangles": len(f),
                "minimum_projected_double_area": float(abs(signed).min()),
            }
        )
    full_attrs = {k: np.concatenate(v) for k, v in attrs.items()}
    full_tri = np.concatenate(faces)
    p = full_attrs["POSITION"]
    normal = np.zeros_like(p, dtype=float)
    fn = np.cross(
        p[full_tri[:, 1]] - p[full_tri[:, 0]], p[full_tri[:, 2]] - p[full_tri[:, 0]]
    )
    for col in range(3):
        np.add.at(normal, full_tri[:, col], fn)
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-30)
    full_attrs["NORMAL"][len(pos) :] = normal[len(pos) :]
    used, local = np.unique(full_tri, return_inverse=True)
    final = {k: v[used] for k, v in full_attrs.items()}
    np.savez_compressed(out / "body.npz", **final, triangles=local.reshape(-1, 3))
    report = {
        "source_sha256": digest(g.raw),
        "body": {
            "retained_source_triangles": len(tri),
            "removed_source_triangles": int(remove.sum()),
            "patches": patch_reports,
            "profile_height": hs,
            "profile_radius": rs,
            "profile_degree": 8,
            "topology": topology(final["POSITION"], local.reshape(-1, 3)),
        },
    }
    (out / "audit.json").write_text(json.dumps(report, indent=2))
