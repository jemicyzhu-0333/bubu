"""Prune orphan data without changing any referenced accessor bytes or material value."""

from pathlib import Path
import copy, json, struct, argparse, hashlib
import numpy as np
from split_glb import GLB, digest


def compact(source, destination, proof_path=None):
    g = GLB(source)
    old = g.doc
    if old.get("skins") or old.get("animations") or old.get("cameras"):
        raise ValueError(
            "Expected hybrid geometry template without rig/animations/cameras"
        )
    doc = {
        k: copy.deepcopy(old[k])
        for k in ["asset", "scene", "scenes", "nodes", "meshes"]
        if k in old
    }
    for k in ["extensions", "extras"]:
        if k in old:
            doc[k] = copy.deepcopy(old[k])
    accessors = set()
    materials = set()
    for mesh in doc["meshes"]:
        for p in mesh["primitives"]:
            accessors.update(p["attributes"].values())
            if "indices" in p:
                accessors.add(p["indices"])
            for target in p.get("targets", []):
                accessors.update(target.values())
            if "material" in p:
                materials.add(p["material"])
            if p.get("extensions"):
                raise ValueError(
                    "Primitive extensions need explicit reference handling"
                )
    material_ids = sorted(materials)
    material_map = {old_i: i for i, old_i in enumerate(material_ids)}
    doc["materials"] = [copy.deepcopy(old["materials"][i]) for i in material_ids]

    # Approved body material has no textures; refuse rather than silently dropping references.
    def check_texture(value):
        if isinstance(value, dict):
            for key, v in value.items():
                if key.endswith("Texture") and isinstance(v, dict) and "index" in v:
                    raise ValueError(
                        "Texture-bearing materials require explicit compaction support"
                    )
                check_texture(v)
        elif isinstance(value, list):
            for v in value:
                check_texture(v)

    check_texture(doc["materials"])
    acc_ids = sorted(accessors)
    acc_map = {old_i: i for i, old_i in enumerate(acc_ids)}
    views = set()
    for i in acc_ids:
        a = old["accessors"][i]
        if "bufferView" in a:
            views.add(a["bufferView"])
        if "sparse" in a:
            views.update(
                [
                    a["sparse"]["indices"]["bufferView"],
                    a["sparse"]["values"]["bufferView"],
                ]
            )
    bv_ids = sorted(views)
    bv_map = {old_i: i for i, old_i in enumerate(bv_ids)}
    data = bytearray()
    doc["bufferViews"] = []
    for i in bv_ids:
        v = copy.deepcopy(old["bufferViews"][i])
        if v.get("buffer", 0) != 0 or v.get("extensions"):
            raise ValueError("Unsupported buffer view reference")
        start = v.get("byteOffset", 0)
        raw = g.bin[start : start + v["byteLength"]]
        while len(data) % 4:
            data.append(0)
        v["buffer"] = 0
        v["byteOffset"] = len(data)
        data.extend(raw)
        doc["bufferViews"].append(v)
    doc["accessors"] = []
    for i in acc_ids:
        a = copy.deepcopy(old["accessors"][i])
        if "bufferView" in a:
            a["bufferView"] = bv_map[a["bufferView"]]
        if "sparse" in a:
            for key in ["indices", "values"]:
                a["sparse"][key]["bufferView"] = bv_map[a["sparse"][key]["bufferView"]]
        doc["accessors"].append(a)
    for mesh in doc["meshes"]:
        for p in mesh["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            if "material" in p:
                p["material"] = material_map[p["material"]]
            for target in p.get("targets", []):
                for k, v in list(target.items()):
                    target[k] = acc_map[v]
    used_extensions = set()

    def find_extensions(value):
        if isinstance(value, dict):
            used_extensions.update(value.get("extensions", {}).keys())
            for v in value.values():
                find_extensions(v)
        elif isinstance(value, list):
            for v in value:
                find_extensions(v)

    find_extensions(doc)
    if used_extensions:
        doc["extensionsUsed"] = sorted(used_extensions)
    required = set(old.get("extensionsRequired", [])) & used_extensions
    if required:
        doc["extensionsRequired"] = sorted(required)
    while len(data) % 4:
        data.append(0)
    doc["buffers"] = [{"byteLength": len(data)}]
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    raw = (
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + 8 + len(data))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(data), 0x004E4942)
        + data
    )
    Path(destination).write_bytes(raw)
    new = GLB(destination)
    proof = {
        "source_sha256": digest(g.raw),
        "compact_sha256": digest(raw),
        "source_bytes": len(g.raw),
        "compact_bytes": len(raw),
        "referenced_accessor_arrays": [],
        "scene_nodes_exact": doc["nodes"] == old["nodes"]
        and doc["scenes"] == old["scenes"],
        "referenced_material_values_exact": True,
        "old_counts": {
            k: len(old.get(k, [])) for k in ["accessors", "bufferViews", "materials"]
        },
        "compact_counts": {
            k: len(doc.get(k, [])) for k in ["accessors", "bufferViews", "materials"]
        },
        "removed_orphan_data_only": True,
    }
    for old_i, new_i in acc_map.items():
        a = g.accessor(old_i)
        b = new.accessor(new_i)
        exact = a.dtype == b.dtype and a.shape == b.shape and a.tobytes() == b.tobytes()
        if not exact:
            raise ValueError("Accessor byte mismatch")
        proof["referenced_accessor_arrays"].append(
            {
                "old": old_i,
                "compact": new_i,
                "componentType": old["accessors"][old_i]["componentType"],
                "type": old["accessors"][old_i]["type"],
                "count": len(a),
                "array_sha256": digest(a.tobytes()),
                "byte_exact": exact,
            }
        )
    for i, j in material_map.items():
        if old["materials"][i] != doc["materials"][j]:
            raise ValueError("Material changed")
    proof["meshes"] = []
    for mi, (m, n) in enumerate(zip(old["meshes"], doc["meshes"])):
        if m["name"] != n["name"] or len(m["primitives"]) != len(n["primitives"]):
            raise ValueError("Mesh names/primitives changed")
        for pi, (p, q) in enumerate(zip(m["primitives"], n["primitives"])):
            if set(p["attributes"]) != set(q["attributes"]):
                raise ValueError("Attribute semantics changed")
            proof["meshes"].append(
                {
                    "name": m["name"],
                    "primitive": pi,
                    "attribute_accessors": {
                        k: {"old": v, "compact": q["attributes"][k]}
                        for k, v in p["attributes"].items()
                    },
                    "indices": {"old": p.get("indices"), "compact": q.get("indices")},
                    "attribute_and_index_bytes_exact": True,
                }
            )
    if proof_path:
        Path(proof_path).write_text(json.dumps(proof, indent=2) + "\n")
    return proof


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("destination")
    ap.add_argument("--proof")
    a = ap.parse_args()
    p = compact(a.source, a.destination, a.proof)
    print(
        json.dumps(
            {
                k: p[k]
                for k in [
                    "source_sha256",
                    "compact_sha256",
                    "source_bytes",
                    "compact_bytes",
                    "old_counts",
                    "compact_counts",
                ]
            },
            indent=2,
        )
    )
