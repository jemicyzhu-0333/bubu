#!/usr/bin/env python3
"""Lossless source-core limb partition. No inferred source or repaired torso claims."""
from __future__ import annotations
import argparse, hashlib, json, struct
from pathlib import Path
from collections import defaultdict, Counter
import numpy as np

DT = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
SZ = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
NAMES = ["body", "handL", "handR", "footL", "footR"]
SOURCE_SHA = "84ec5d8608f21e43bf06df26b8b2f81124909ebb39c77bb9cc153aca17319a3a"


def digest(b):
    return hashlib.sha256(b).hexdigest()


class GLB:
    def __init__(self, path):
        self.raw = Path(path).read_bytes()
        if len(self.raw) < 12:
            raise ValueError("Truncated GLB")
        magic, version, total = struct.unpack_from("<4sII", self.raw)
        if magic != b"glTF" or version != 2 or total != len(self.raw):
            raise ValueError("Invalid GLB header")
        chunks = []
        off = 12
        while off < total:
            if off + 8 > total:
                raise ValueError("Truncated chunk header")
            size, kind = struct.unpack_from("<II", self.raw, off)
            off += 8
            if size % 4 or off + size > total:
                raise ValueError("Invalid chunk length")
            chunks.append((kind, self.raw[off : off + size]))
            off += size
        if not chunks or chunks[0][0] != 0x4E4F534A:
            raise ValueError("JSON must be first")
        self.doc = json.loads(chunks[0][1])
        bins = [v for k, v in chunks if k == 0x004E4942]
        if len(bins) > 1:
            raise ValueError("Multiple BIN chunks")
        self.bin = bins[0] if bins else b""
        for b in self.doc.get("buffers", []):
            if "uri" in b:
                raise ValueError("External/data buffers unsupported; embed first")
            if b["byteLength"] > len(self.bin):
                raise ValueError("Truncated buffer")

    def view(self, idx, offset, count, dtype, width, stride=None):
        bv = self.doc["bufferViews"][idx]
        if bv.get("buffer", 0) != 0:
            raise ValueError("Only embedded buffer 0 supported")
        dt = np.dtype(dtype)
        stride = stride or bv.get("byteStride", dt.itemsize * width)
        start = bv.get("byteOffset", 0) + offset
        needed = 0 if count == 0 else (count - 1) * stride + dt.itemsize * width
        if (
            stride < dt.itemsize * width
            or offset < 0
            or offset + needed > bv["byteLength"]
            or start + needed > len(self.bin)
        ):
            raise ValueError("Accessor out of bounds")
        return np.ndarray(
            (count, width), dt, self.bin, start, (stride, dt.itemsize)
        ).copy()

    def accessor(self, idx, normalized=False):
        a = self.doc["accessors"][idx]
        typ = a["type"]
        if typ not in SZ:
            raise ValueError("Unsupported accessor type: " + typ)
        n, w = a["count"], SZ[typ]
        dt = DT[a["componentType"]]
        r = (
            self.view(a["bufferView"], a.get("byteOffset", 0), n, dt, w)
            if "bufferView" in a
            else np.zeros((n, w), dt)
        )
        if "sparse" in a:
            s = a["sparse"]
            si = s["indices"]
            sv = s["values"]
            if si["componentType"] not in (5121, 5123, 5125):
                raise ValueError("Bad sparse index type")
            ix = self.view(
                si["bufferView"],
                si.get("byteOffset", 0),
                s["count"],
                DT[si["componentType"]],
                1,
            ).ravel()
            if len(ix) and (ix[-1] >= n or np.any(ix[1:] <= ix[:-1])):
                raise ValueError("Invalid sparse indices")
            r[ix] = self.view(
                sv["bufferView"], sv.get("byteOffset", 0), s["count"], dt, w
            )
        if (
            normalized
            and a.get("normalized", False)
            and np.issubdtype(r.dtype, np.integer)
        ):
            info = np.iinfo(r.dtype)
            r = np.maximum(r.astype(np.float64) / info.max, -1)
        return r

    def primitive(self, mesh, primitive):
        p = self.doc["meshes"][mesh]["primitives"][primitive]
        if p.get("mode", 4) != 4 or p.get("extensions", {}).get(
            "KHR_draco_mesh_compression"
        ):
            raise ValueError("Require plain triangle primitive")
        attrs = {k: self.accessor(v) for k, v in p["attributes"].items()}
        count = len(attrs["POSITION"])
        if any(len(v) != count for v in attrs.values()):
            raise ValueError("Attribute count mismatch")
        idx = (
            self.accessor(p["indices"]).ravel() if "indices" in p else np.arange(count)
        )
        if len(idx) % 3 or (len(idx) and idx.max() >= count):
            raise ValueError("Invalid triangle indices")
        return p, attrs, idx.reshape(-1, 3).astype(np.int64)


def partition(g, mesh, primitive, joint_to_part):
    p, attrs, tri = g.primitive(mesh, primitive)
    if not {"JOINTS_0", "WEIGHTS_0"} <= attrs.keys():
        raise ValueError("Missing skin weights")
    score = np.zeros((len(attrs["POSITION"]), 5), np.float64)
    for suffix in ("0", "1"):
        jk, wk = "JOINTS_" + suffix, "WEIGHTS_" + suffix
        if (jk in attrs) != (wk in attrs):
            raise ValueError("Unpaired skin attributes")
        if jk not in attrs:
            continue
        weights = g.accessor(p["attributes"][wk], True)
        if not np.isfinite(weights).all() or np.any(weights < 0):
            raise ValueError("Invalid weights")
        for joint, part in joint_to_part.items():
            score[:, part] += (weights * (attrs[jk] == joint)).sum(axis=1)
        unknown = set(np.unique(attrs[jk][weights > 0]).tolist()) - set(joint_to_part)
        if unknown:
            raise ValueError("Unmapped weighted joints: " + str(unknown))
    if np.any(score.sum(axis=1) <= 0):
        raise ValueError("Unweighted vertices")
    # Deliberately no normalization: classification uses original average weights.
    owner = score[tri].mean(axis=1).argmax(axis=1)
    result = []
    for part, name in enumerate(NAMES):
        faces = np.flatnonzero(owner == part)
        vids, local = np.unique(tri[faces], return_inverse=True)
        result.append(
            dict(
                name=name,
                source_vertex_ids=vids,
                source_triangle_ids=faces,
                triangles=local.reshape(-1, 3),
                attributes={k: v[vids].copy() for k, v in attrs.items()},
            )
        )
    return result, attrs, tri


def topology(pos, tri):
    edges = defaultdict(list)
    for face, (a, b, c) in enumerate(tri):
        for u, v in ((a, b), (b, c), (c, a)):
            edges[tuple(sorted((int(u), int(v))))].append((int(u), int(v), face))
    boundary = [v[0][:2] for v in edges.values() if len(v) == 1]
    bad = [k for k, v in edges.items() if len(v) > 2]
    winding = [k for k, v in edges.items() if len(v) == 2 and v[0][:2] == v[1][:2]]
    areas = np.linalg.norm(
        np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]]),
        axis=1,
    )
    outgoing = defaultdict(list)
    incoming = Counter()
    for a, b in boundary:
        outgoing[a].append(b)
        incoming[b] += 1
    branch = sorted(
        v
        for v in set(outgoing) | set(incoming)
        if len(outgoing[v]) != 1 or incoming[v] != 1
    )
    loops = []
    if not branch:
        todo = set(boundary)
        while todo:
            a, b = min(todo)
            loop = [a]
            start = a
            while True:
                if (a, b) not in todo:
                    raise ValueError("Broken boundary traversal")
                todo.remove((a, b))
                a = b
                if a == start:
                    break
                loop.append(a)
                b = outgoing[a][0]
            loops.append(loop)
    return dict(
        vertices=len(pos),
        triangles=len(tri),
        boundary_edges=len(boundary),
        boundary_loops=loops,
        boundary_branch_vertices=branch,
        nonmanifold_edges=len(bad),
        winding_conflicts=len(winding),
        degenerate_triangles=int((areas <= 1e-14).sum()),
        finite=bool(np.isfinite(pos).all()),
        minimum_double_area=float(areas.min()) if len(areas) else None,
    )


def collar(part, direction, depth, cap_depth=0.015, geometric_normals=False):
    """Append a recessed ring and center cap; source vertices/faces remain untouched.
    Visibility/intersection must be checked by caller; 'recessed' isn't evidence of hiding.
    """
    attrs = part["attributes"]
    pos = attrs["POSITION"]
    tri = part["triangles"]
    audit = topology(pos, tri)
    if (
        audit["boundary_branch_vertices"]
        or audit["nonmanifold_edges"]
        or audit["winding_conflicts"]
    ):
        raise ValueError("Cannot collar invalid boundary")
    d = np.asarray(direction, dtype=float)
    length = np.linalg.norm(d)
    if not np.isfinite(d).all() or length < 1e-12 or depth <= 0 or cap_depth < 0:
        raise ValueError("Invalid collar parameters")
    d /= length
    out = {k: [v.copy()] for k, v in attrs.items()}
    extra = []
    count = len(pos)
    for loop in audit["boundary_loops"]:
        n = len(loop)
        ring = count
        center = ring + n
        count += n + 1
        for k, v in attrs.items():
            r = v[loop].copy()
            c = v[loop[:1]].copy()
            if k == "POSITION":
                r = (r.astype(float) + d * depth).astype(v.dtype)
                c = (pos[loop].mean(axis=0) + d * (depth + cap_depth)).astype(v.dtype)[
                    None, :
                ]
            out[k].extend((r, c))
        for i, a in enumerate(loop):
            j = (i + 1) % n
            b = loop[j]
            # Oppose original boundary edge, then close new ring with opposite winding.
            extra.extend(
                (
                    (b, a, ring + i),
                    (b, ring + i, ring + j),
                    (ring + j, ring + i, center),
                )
            )
    result = {
        **part,
        "attributes": {k: np.concatenate(v) for k, v in out.items()},
        "triangles": np.concatenate(
            (tri, np.array(extra, dtype=np.int64).reshape(-1, 3))
        ),
    }
    if geometric_normals and "NORMAL" in result["attributes"]:
        # Only appended vertices change. All immutable source normals stay exact.
        p = result["attributes"]["POSITION"]
        t = result["triangles"]
        norm = np.zeros_like(p, dtype=np.float64)
        fn = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])
        for column in range(3):
            np.add.at(norm, t[:, column], fn)
        lengths = np.linalg.norm(norm, axis=1)
        if np.any(lengths[len(pos) :] < 1e-12):
            raise ValueError("Undefined appended normal")
        result["attributes"]["NORMAL"][len(pos) :] = (
            norm[len(pos) :] / lengths[len(pos) :, None]
        ).astype(result["attributes"]["NORMAL"].dtype)
    result["core_vertex_count"] = len(pos)
    result["core_triangle_count"] = len(tri)
    final = topology(result["attributes"]["POSITION"], result["triangles"])
    if (
        final["boundary_edges"]
        or final["nonmanifold_edges"]
        or final["winding_conflicts"]
        or final["degenerate_triangles"]
        or not final["finite"]
    ):
        raise ValueError("Collar fails topology audit: " + json.dumps(final))
    return result


def provenance(part, source_attrs, source_tri):
    ids = part["source_vertex_ids"]
    faces = part["source_triangle_ids"]
    n = len(ids)
    f = len(faces)
    exact = {
        k: bool(np.array_equal(v[:n], source_attrs[k][ids]))
        for k, v in part["attributes"].items()
    }
    hashes = {
        k: digest(np.ascontiguousarray(v[:n]).tobytes())
        for k, v in part["attributes"].items()
    }
    face_exact = bool(np.array_equal(ids[part["triangles"][:f]], source_tri[faces]))
    return dict(
        core_vertices=n,
        core_triangles=f,
        exact_attributes=exact,
        core_attribute_sha256=hashes,
        exact_source_triangles=face_exact,
        all_exact=all(exact.values()) and face_exact,
    )
