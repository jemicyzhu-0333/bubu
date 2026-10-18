#!/usr/bin/env python3
"""Original-source skinning for lower body/feet; rigid exact-source hands."""
from pathlib import Path
import json, argparse
import numpy as np
from split_glb import *
from write_static import write_static


def build(source, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    g = GLB(source)
    if digest(g.raw) != SOURCE_SHA:
        raise ValueError("Unapproved source")
    parts, source_attrs, source_tri = partition(
        g, 6, 0, {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 0, 6: 0}
    )
    from build_hand_repair import build as build_hand_repair

    base = out / "hand-repair-intermediate"
    build_hand_repair(source, base)
    audit = json.loads((base / "audit.json").read_text())
    a = np.load(base / "body.npz")
    attrs = {k: a[k].copy() for k in a.files if k != "triangles"}
    t = a["triangles"]
    retained = audit["body"]["retained_source_triangles"]
    keep = [t[:retained]]
    offset = retained
    for patch in audit["body"]["patches"]:
        n = patch["triangles"]
        if patch["region"] == "hand":
            keep.append(t[offset : offset + n])
        offset += n
    faces = np.concatenate(keep)
    used, local = np.unique(faces, return_inverse=True)
    attrs = {k: v[used] for k, v in attrs.items()}
    body_tri = local.reshape(-1, 3)
    mapping = {tuple(p): i for i, p in enumerate(source_attrs["POSITION"])}
    source_ids = np.array([mapping.get(tuple(p), -1) for p in attrs["POSITION"]])
    new = source_ids < 0
    if new.sum() != 469:
        raise ValueError("Unexpected hand patch interior count")
    original_joints = attrs["JOINTS_0"].copy()
    original_weights = attrs["WEIGHTS_0"].copy()
    # Cap interiors must not follow detached hand bones.
    attrs["JOINTS_0"][new] = 0
    attrs["WEIGHTS_0"][new] = 0
    attrs["WEIGHTS_0"][new, 0] = 1
    shoulder = (
        (attrs["POSITION"][:, 1] > 0.43)
        & np.any(
            ((attrs["JOINTS_0"] == 1) | (attrs["JOINTS_0"] == 2))
            & (attrs["WEIGHTS_0"] > 0),
            axis=1,
        )
        & ~new
    )
    for i in np.flatnonzero(shoulder):
        dense = np.zeros(7, dtype=np.float64)
        for j, w in zip(attrs["JOINTS_0"][i], attrs["WEIGHTS_0"][i]):
            dense[j] += w
        dense[0] += dense[1] + dense[2]
        dense[1:3] = 0
        order = np.argsort(-dense)[:4]
        attrs["JOINTS_0"][i] = order
        attrs["WEIGHTS_0"][i] = dense[order]
    changed = np.any(attrs["JOINTS_0"] != original_joints, axis=1) | np.any(
        attrs["WEIGHTS_0"] != original_weights, axis=1
    )
    body = {
        "name": "Bubu_body",
        "attributes": attrs,
        "triangles": body_tri,
        "keep_skin_attributes": True,
    }
    output = [body]
    report = {
        "source_sha256": digest(g.raw),
        "binding": "body and feet native-skin original actor skeleton; hands rigid",
        "patch_policy": "469 new hand-cap interior vertices Body1; original shoulder influence redirected to Body only where sourceY>.43. Original hip support ends belowY.424; original lower-body and foot skin attributes remain exact.",
        "source_skin": g.doc["skins"][0],
        "body": {
            "vertices": len(source_ids),
            "triangles": len(body_tri),
            "new_hand_patch_vertices": int(new.sum()),
            "redirected_shoulder_vertices": int(shoulder.sum()),
            "changed_skin_attribute_vertices": int(changed.sum()),
        },
        "parts": {},
    }
    lower = (source_ids >= 0) & (attrs["POSITION"][:, 1] <= 0.43)
    report["body"]["lower_source_attributes_exact"] = {
        k: bool(np.array_equal(v[lower], source_attrs[k][source_ids[lower]]))
        for k, v in attrs.items()
    }
    if not all(report["body"]["lower_source_attributes_exact"].values()):
        raise ValueError("Lower source attributes changed")
    hip_weights = (
        source_attrs["WEIGHTS_0"]
        * ((source_attrs["JOINTS_0"] == 3) | (source_attrs["JOINTS_0"] == 4))
    ).sum(1)
    report["hip_support_max_y"] = float(
        source_attrs["POSITION"][hip_weights > 0, 1].max()
    )
    report["shoulder_redirect_min_y"] = float(attrs["POSITION"][shoulder, 1].min())
    report["hip_and_redirect_domains_disjoint"] = bool(
        np.all(hip_weights[source_ids[shoulder]] == 0)
    )
    if not report["hip_and_redirect_domains_disjoint"]:
        raise ValueError("Shoulder redirect overlaps original hip domain")
    body_index = {int(v): i for i, v in enumerate(source_ids) if v >= 0}
    report["foot_seams"] = {}
    report["rigid_mask_diagnosis"] = {}
    for part in parts[3:]:
        shared = np.intersect1d(source_ids, part["source_vertex_ids"])
        body_ix = np.array([body_index[int(v)] for v in shared])
        part_index = {int(v): i for i, v in enumerate(part["source_vertex_ids"])}
        foot_ix = np.array([part_index[int(v)] for v in shared])
        exact = {
            k: bool(np.array_equal(attrs[k][body_ix], part["attributes"][k][foot_ix]))
            for k in attrs
        }
        report["foot_seams"][part["name"]] = {
            "shared_vertices": len(shared),
            "source_attributes_exact": exact,
        }
        if not all(exact.values()):
            raise ValueError("Foot seam attributes differ")
        joint = 3 if part["name"] == "footL" else 4
        pw = (
            part["attributes"]["WEIGHTS_0"] * (part["attributes"]["JOINTS_0"] == joint)
        ).sum(1)
        report["rigid_mask_diagnosis"][part["name"]] = {
            "old_weight_partition_vertices": len(pw),
            "pure_hip_vertices": int((pw >= 1 - 1e-7).sum()),
            "mixed_root_vertices_misclassified_rigid": int((pw < 1 - 1e-7).sum()),
        }
    for part in parts[1:]:
        name = {
            "handL": "Bubu_hand-left",
            "handR": "Bubu_hand-right",
            "footL": "Bubu_foot-left",
            "footR": "Bubu_foot-right",
        }[part["name"]]
        if part["name"].startswith("hand"):
            x = part["attributes"]["POSITION"][:, 0].mean()
            part = collar(part, [-np.sign(x), 0, 0], 0.075)
        else:
            part = {**part, "keep_skin_attributes": True}
        part = {**part, "name": name}
        output.append(part)
        report["parts"][name] = provenance(part, source_attrs, source_tri)
    for part in output:
        np.savez_compressed(
            out / (part["name"] + ".npz"),
            **part["attributes"],
            triangles=part["triangles"]
        )
    np.savez_compressed(
        out / "body-provenance.npz",
        source_vertex_ids=source_ids,
        changed_skin_indices=np.flatnonzero(changed),
        patch_interior_indices=np.flatnonzero(new),
        redirected_shoulder_indices=np.flatnonzero(shoulder),
    )
    glb = out / "bubu-hybrid-binding.glb"
    write_static(g, output, glb, 6, 0)
    from compact_glb import compact

    compact_proof = compact(glb, glb, out / "compact-equivalence.json")
    parsed = GLB(glb)
    report["output_sha256"] = digest(parsed.raw)
    report["storage_lineage"] = {
        k: compact_proof[k]
        for k in [
            "source_sha256",
            "compact_sha256",
            "source_bytes",
            "compact_bytes",
            "old_counts",
            "compact_counts",
        ]
    }
    for i, part in enumerate(output):
        _, loaded, faces = parsed.primitive(i, 0)
        for key, value in part["attributes"].items():
            if key.startswith(("JOINTS_", "WEIGHTS_")) and not part.get(
                "keep_skin_attributes"
            ):
                continue
            if not np.array_equal(loaded[key], value):
                raise ValueError(
                    "GLB attribute roundtrip mismatch " + part["name"] + key
                )
    # Whole assembly has intentional shared source boundaries across skinned body/feet.
    ps = np.concatenate([p["attributes"]["POSITION"] for p in output])
    offset = 0
    ts = []
    for p in output:
        ts.append(p["triangles"] + offset)
        offset += len(p["attributes"]["POSITION"])
    unique, inv = np.unique(ps, axis=0, return_inverse=True)
    report["rest_assembly_topology"] = topology(unique, inv[np.concatenate(ts)])
    if any(
        report["rest_assembly_topology"][k]
        for k in [
            "boundary_edges",
            "nonmanifold_edges",
            "winding_conflicts",
            "degenerate_triangles",
        ]
    ):
        raise ValueError("Assembly topology failed")
    (out / "audit.json").write_text(json.dumps(report, indent=2))
    binding = {
        "asset": "bubu-hybrid-binding.glb",
        "asset_sha256": report["output_sha256"],
        "source_sha256": report["source_sha256"],
        "coordinate_frame": "original source geometry-local; identity GLB node transforms",
        "native_skinned_parts": ["Bubu_body", "Bubu_foot-left", "Bubu_foot-right"],
        "rigid_parts": {"Bubu_hand-left": 1, "Bubu_hand-right": 2},
        "skeleton_contract": "Create THREE.SkinnedMesh for native_skinned_parts using loaded geometry skinIndex/skinWeight; bind to THIS actor original sourceSkin.skeleton and copy its bindMatrix, bindMatrixInverse and bindMode. Do not normalize or alter original weights. Never attach template or another actor skeleton. Hands use original tested rigid adapter transforms.",
        "source_skin_joint_order": [
            "Body",
            "Shoulder_L",
            "Shoulder_R",
            "Hip_L",
            "Hip_R",
            "HeadTouch",
            "AccessoryAnchor",
        ],
        "skin_asset_note": "GLB carries skin vertex attributes but no template Skeleton/skin node binding; actor skeleton binding is runtime-owned.",
        "face_policy": "Retain original actor eight facial meshes and accepted face library; no face geometry appears here.",
        "patch_policy": report["patch_policy"],
    }
    binding["semantic_reference_asset_sha256"] = compact_proof["source_sha256"]
    binding["storage_change"] = (
        "Orphan accessor/bufferView/material pruning only; all referenced arrays byte-exact. Original runtime records keep their original361 hash."
    )
    binding["lower_body_verification_y_max"] = 0.43
    binding["sourceVertexIds"] = {"Bubu_body": source_ids.tolist()}
    for original, generated in zip(parts[1:], output[1:]):
        binding["sourceVertexIds"][generated["name"]] = np.r_[
            original["source_vertex_ids"],
            np.full(
                len(generated["attributes"]["POSITION"])
                - len(original["source_vertex_ids"]),
                -1,
                dtype=int,
            ),
        ].tolist()
    (out / "binding-manifest.json").write_text(json.dumps(binding, indent=2))
    from qualify_hybrid_audit import qualify

    qualify(source, out)
    print(
        json.dumps(
            {
                "asset": str(glb),
                "sha256": report["output_sha256"],
                "body": report["body"],
                "assembly": report["rest_assembly_topology"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("output")
    a = ap.parse_args()
    build(a.source, a.output)
