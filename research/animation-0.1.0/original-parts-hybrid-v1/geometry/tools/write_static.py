"""Write five static meshes while retaining original textures and material bindings."""

import copy, json, struct
import numpy as np
from pathlib import Path
from split_glb import DT


def world_matrix(doc, node):
    parents = {
        c: i for i, n in enumerate(doc.get("nodes", [])) for c in n.get("children", [])
    }

    def local(n):
        if "matrix" in n:
            return np.array(n["matrix"]).reshape(4, 4, order="F")
        x, y, z, w = n.get("rotation", [0, 0, 0, 1])
        r = np.array(
            [
                [
                    1 - 2 * y * y - 2 * z * z,
                    2 * x * y - 2 * z * w,
                    2 * x * z + 2 * y * w,
                ],
                [
                    2 * x * y + 2 * z * w,
                    1 - 2 * x * x - 2 * z * z,
                    2 * y * z - 2 * x * w,
                ],
                [
                    2 * x * z - 2 * y * w,
                    2 * y * z + 2 * x * w,
                    1 - 2 * x * x - 2 * y * y,
                ],
            ]
        )
        m = np.eye(4)
        m[:3, :3] = r @ np.diag(n.get("scale", [1, 1, 1]))
        m[:3, 3] = n.get("translation", [0, 0, 0])
        return m

    chain = []
    seen = set()
    while True:
        if node in seen:
            raise ValueError("Node cycle")
        seen.add(node)
        chain.append(node)
        if node not in parents:
            break
        node = parents[node]
    m = np.eye(4)
    for node in reversed(chain):
        m = m @ local(doc["nodes"][node])
    return m


def write_static(g, parts, path, mesh=0, primitive=0):
    doc = copy.deepcopy(g.doc)
    bin = bytearray(g.bin)
    p = doc["meshes"][mesh]["primitives"][primitive]
    occurrences = [
        i for i, n in enumerate(doc.get("nodes", [])) if n.get("mesh") == mesh
    ]
    if len(occurrences) != 1:
        raise ValueError("Source mesh must have exactly one node")
    transform = world_matrix(doc, occurrences[0])
    doc["meshes"] = []
    doc["nodes"] = []
    doc["scenes"] = [{"nodes": list(range(len(parts)))}]
    doc["scene"] = 0
    doc.pop("skins", None)
    doc.pop("animations", None)
    doc.setdefault("accessors", [])
    doc.setdefault("bufferViews", [])

    def append(arr, template=None, index=False):
        nonlocal bin
        arr = np.ascontiguousarray(arr)
        if index:
            arr = arr.astype("<u4").reshape(-1, 1)
        while len(bin) % 4:
            bin.append(0)
        offset = len(bin)
        raw = arr.tobytes()
        bin.extend(raw)
        bv = len(doc["bufferViews"])
        doc["bufferViews"].append(
            {
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": len(raw),
                "target": 34963 if index else 34962,
            }
        )
        a = copy.deepcopy(template or {})
        a.pop("sparse", None)
        a.update(bufferView=bv, byteOffset=0, count=len(arr))
        if index:
            a.update(componentType=5125, type="SCALAR")
        if not template and not index:
            a.update(
                componentType=next(
                    k for k, v in DT.items() if np.dtype(v) == arr.dtype
                ),
                type={1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}[arr.shape[1]],
            )
        a.pop("min", None)
        a.pop("max", None)
        if not index and a["type"] == "VEC3" and arr.dtype.kind == "f":
            a.update(min=arr.min(axis=0).tolist(), max=arr.max(axis=0).tolist())
        idx = len(doc["accessors"])
        doc["accessors"].append(a)
        return idx

    for part in parts:
        attributes = {}
        for key, arr in part["attributes"].items():
            if key.startswith(("JOINTS_", "WEIGHTS_")) and not part.get(
                "keep_skin_attributes", False
            ):
                continue
            template = (
                g.doc["accessors"][p["attributes"][key]]
                if key in p["attributes"]
                else None
            )
            attributes[key] = append(arr, template)
        prim = {
            "attributes": attributes,
            "indices": append(part["triangles"], index=True),
            "mode": 4,
        }
        if "material" in p:
            prim["material"] = p["material"]
        idx = len(doc["meshes"])
        doc["meshes"].append({"name": part["name"], "primitives": [prim]})
        doc["nodes"].append(
            {
                "name": part["name"],
                "mesh": idx,
                "matrix": transform.ravel(order="F").tolist(),
            }
        )
    while len(bin) % 4:
        bin.append(0)
    doc["buffers"] = [{"byteLength": len(bin)}]
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    data = (
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + 8 + len(bin))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(bin), 0x004E4942)
        + bin
    )
    Path(path).write_bytes(data)
