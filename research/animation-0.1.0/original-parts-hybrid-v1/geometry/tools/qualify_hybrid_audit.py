"""Qualify retained-source equality and measure omitted tiny-hip motion contribution."""

import json, argparse
import numpy as np
from pathlib import Path
from split_glb import *


def qualify(source, output, keyposes=None):
    out = Path(output)
    g = GLB(source)
    parts, a, t = partition(g, 6, 0, {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 0, 6: 0})
    ids = np.load(out / "body-provenance.npz")["source_vertex_ids"]
    p = a["POSITION"].astype(float)
    W = np.array([(a["WEIGHTS_0"] * (a["JOINTS_0"] == j)).sum(1) for j in range(7)]).T
    removed = np.setdiff1d(parts[0]["source_vertex_ids"], ids[ids >= 0])
    omitted = removed[W[removed, 3:5].sum(1) > 0]
    d = json.load(open(out / "audit.json"))
    body = np.load(out / "Bubu_body.npz")
    new = ids < 0
    d["patch_policy"] = d["patch_policy"].replace(
        "Original lower-body and foot skin attributes remain exact.",
        "Retained original lower-body source attributes and complete foot attributes remain exact; the hand-root repair removes29 tiny-hip-influenced source vertices.",
    )
    d["body"]["retained_lower_source_attributes_exact"] = d["body"].pop(
        "lower_source_attributes_exact",
        d["body"].get("retained_lower_source_attributes_exact"),
    )
    d["body"]["removed_source_body_triangles"] = 3798
    d["body"]["removed_source_body_vertices"] = len(removed)
    d["body"]["removed_hip_influenced_source_vertex_ids"] = omitted.tolist()
    d["body"]["removed_hip_influenced_count"] = len(omitted)
    d["body"]["removed_hip_max_weight"] = float(W[omitted, 3:5].max())
    d["body"]["removed_hip_y_range"] = [
        float(p[omitted, 1].min()),
        float(p[omitted, 1].max()),
    ]
    d["body"]["new_hand_patch_vertices_below_verification_y"] = int(
        (new & (body["POSITION"][:, 1] <= 0.43)).sum()
    )
    if keyposes:
        doc = json.load(open(keyposes))
        rows = []

        def fit(x, y):
            xc = x.mean(0)
            yc = y.mean(0)
            u, s, vt = np.linalg.svd((x - xc).T @ (y - yc))
            r = vt.T @ u.T
            if np.linalg.det(r) < 0:
                vt[-1] *= -1
                r = vt.T @ u.T
            trans = yc - r @ xc
            return r, trans, float(np.linalg.norm(x @ r.T + trans - y, axis=1).max())

        for frame in doc["frames"]:
            mesh = next(v for v in frame["meshes"] if v["name"] == "A_mochi_skin")
            world = (
                np.fromfile(mesh["positionsFile"], dtype="<f4")
                .reshape(-1, 3)
                .astype(float)
            )
            transforms = {}
            for joint in [0, 3, 4]:
                pure = W[:, joint] >= 1 - 1e-7
                transforms[joint] = fit(p[pure], world[pure])
            rb, tb, _ = transforms[0]
            body_pos = p[omitted] @ rb.T + tb
            delta = np.zeros_like(body_pos)
            for joint in [3, 4]:
                r, tt, _ = transforms[joint]
                delta += W[omitted, joint, None] * (p[omitted] @ r.T + tt - body_pos)
            rows.append(
                {
                    "time": frame["time"],
                    "maximum_removed_hip_motion_contribution": float(
                        np.linalg.norm(delta, axis=1).max()
                    ),
                    "fit_max_residual": {str(j): v[2] for j, v in transforms.items()},
                }
            )
        d["omitted_hip_motion_measurement"] = {
            "scope": "Hip contribution relative to Body at the29 omitted source positions, reconstructed from proper-rigid pure-weight original-source world vertices. This is NOT total geometric replacement error.",
            "keyposes": rows,
            "max_contribution": max(
                v["maximum_removed_hip_motion_contribution"] for v in rows
            ),
        }
    (out / "audit.json").write_text(json.dumps(d, indent=2))
    m = json.load(open(out / "binding-manifest.json"))
    m["patch_policy"] = d["patch_policy"]
    m["verification_scope"] = (
        "Retained original body vertices atY<=.43 plus complete foot meshes; excludes replaced hand-root source vertices and new hand-cap interiors."
    )
    (out / "binding-manifest.json").write_text(json.dumps(m, indent=2))
    print(
        json.dumps(
            {
                "removedHip": len(omitted),
                "measurement": d.get("omitted_hip_motion_measurement"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("output")
    ap.add_argument("--keyposes")
    a = ap.parse_args()
    qualify(a.source, a.output, a.keyposes)
