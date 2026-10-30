"""Author an opt-in common native collision/render cage, never an approved asset.

The cage itself does not collide. Original exterior triangles are its skin.
Construction/coverage are necessary contracts, not dynamic acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "tea-swept-51-v1"
NUMERIC = np.sqrt(3) * 2**-22


def unit(vector):
    return vector / np.linalg.norm(vector)


def make_sections(parts):
    cloth = np.array(parts["cape_cloth"]["positions"]).reshape(161, 19, 3)
    back = np.array(parts["cape_back_edge"]["positions"]).reshape(161, 13, 3)
    hem = np.array(parts["cape_hem"]["positions"]).reshape(161, 13, 3)
    positions, sections = [], []
    for column in range(161):
        curve = cloth[column]
        triangles = []
        for ring, direction in [(back[column], curve[1] - curve[0]),
                                (hem[column], curve[-2] - curve[-1])]:
            center = ring[1:].mean(axis=0)
            normal = unit(np.cross(ring[1] - center, ring[4] - center))
            inward = unit(direction - normal * (direction @ normal))
            depth = unit(np.cross(normal, inward))
            radius = np.linalg.norm(ring - center, axis=1).max() + 1e-6
            triangles.append(np.array([
                center - inward * 2 * radius,
                center + inward * radius + depth * np.sqrt(3) * radius,
                center + inward * radius - depth * np.sqrt(3) * radius,
            ]))
        top, bottom = triangles
        if np.dot(top[1] - top[2], bottom[1] - bottom[2]) < 0:
            bottom[[1, 2]] = bottom[[2, 1]]
        middle = curve[9]
        depth = unit((top[1] - top[2]) + (bottom[1] - bottom[2]))
        height = .012
        for row, point in enumerate(curve[1:-1], 1):
            v = row / 18
            chord = (curve[0] * (1 - 2*v) + middle * 2*v if v <= .5
                     else middle * (2 - 2*v) + curve[-1] * (2*v - 1))
            height = max(height, abs((point - chord) @ depth) /
                         max(1e-9, 2 * min(v, 1-v)) + .012)
        positions.extend(np.concatenate([
            top, [middle + depth*height, middle - depth*height], bottom,
        ]).tolist())
        sections.append({"u": column / 160, "height": float(height)})
    # One existing column interval at either end encloses the original end
    # surfaces. These guards are not added collision geometry.
    positions = np.concatenate([
        np.array(positions[:8]) - (cloth[1].mean(0) - cloth[0].mean(0)),
        positions,
        np.array(positions[-8:]) + (cloth[-1].mean(0) - cloth[-2].mean(0)),
    ]).astype(np.float32)
    sections = [{"u": -1/160, "height": sections[0]["height"]}] + sections + [
        {"u": 161/160, "height": sections[-1]["height"]}]
    for i, section in enumerate(sections):
        section["backIds"] = list(range(i*8, i*8+3))
    cross = [[0, 1, 2], [1, 3, 4], [1, 4, 2], [3, 6, 7], [3, 7, 4], [5, 7, 6]]
    cells = []
    for column in range(len(sections) - 1):
        for triangle in cross:
            a, b, c = sorted(column*8 + i for i in triangle)
            cells.extend([[a, b, c, c+8], [a, b, b+8, c+8], [a, a+8, b+8, c+8]])
    cells = np.array(cells)
    vertices = positions[cells].astype(float)
    determinants = np.linalg.det(np.transpose(vertices[:, 1:] - vertices[:, :1], (0, 2, 1)))
    flip = determinants < 0
    cells[flip, 1], cells[flip, 2] = cells[flip, 2].copy(), cells[flip, 1].copy()
    return positions.astype(float).tolist(), cells.tolist(), sections


class MaterialPoints:
    def __init__(self, positions, cells):
        self.positions, self.cells = positions, cells
        self.feature_counts = {}

    def arrays(self):
        positions, cells = np.array(self.positions), np.array(self.cells)
        vertices = positions[cells]
        inverse = np.linalg.inv(np.transpose(vertices[:, 1:] - vertices[:, :1], (0, 2, 1)))
        return positions, cells, vertices, inverse

    def insert(self, point):
        point = np.asarray(point, dtype=np.float32).astype(float)
        positions, cells, vertices, inverse = self.arrays()
        distance = np.linalg.norm(positions - point, axis=1)
        nearest = distance.argmin()
        if distance[nearest] <= NUMERIC:
            return int(nearest)
        bary = np.einsum('kij,kj->ki', inverse, point - vertices[:, 0])
        bary = np.c_[1-bary.sum(axis=1), bary]
        best = bary.min(axis=1).argmax()
        assert bary[best].min() >= -1e-6, "Uncovered material point"
        gradients = np.r_[-inverse[best].sum(axis=0)[None, :], inverse[best]]
        face_distance = np.abs(bary[best]) / np.linalg.norm(gradients, axis=1)
        feature = cells[best][face_distance > NUMERIC].tolist()
        assert len(feature) >= 2
        # Split the complete incident feature star, avoiding a T-junction.
        affected = [i for i, cell in enumerate(self.cells)
                    if all(j in cell for j in feature)]
        particle = len(self.positions)
        self.positions.append(point.tolist())
        replacement = []
        for i in affected:
            cell = self.cells[i]
            for vertex in feature:
                ids = [particle] + [j for j in cell if j != vertex]
                points = np.array(self.positions)[ids]
                volume = np.linalg.det((points[1:] - points[0]).T) / 6
                if volume < 0:
                    ids[2], ids[3], volume = ids[3], ids[2], -volume
                assert volume > 1e-10, "Degenerate inserted cell"
                replacement.append(ids)
        for i in sorted(affected, reverse=True):
            self.cells.pop(i)
        self.cells.extend(replacement)
        size = len(feature)
        self.feature_counts[size] = self.feature_counts.get(size, 0) + 1
        return particle


def author():
    inputs = [ROOT / "secondary-motion/cloth-probe" / name for name in
              ["cape-coarse.json", "attachment-profiles.json"]]
    inputs.append(ROOT / "integration/diagnostics/contact-contract-20261019/frozen-cape.json")
    coarse, catalog, frozen = [json.loads(path.read_bytes()) for path in inputs]
    assert hashlib.sha256(inputs[0].read_bytes()).hexdigest() == catalog["simulationSHA256"]
    parts = {part["name"]: part for part in frozen["parts"]}
    positions, cells, sections = make_sections(parts)
    material = MaterialPoints(positions, cells)
    pins, records = [], []
    coarse_points = np.array(coarse["positions"]).reshape(-1, 3)
    for original in coarse["pins"]:
        if original in catalog["profiles"][PROFILE]["releasedPins"]:
            continue
        particle = material.insert(coarse_points[original])
        pins.append(particle)
        records.append({"original": original, "particle": particle,
                        "position": coarse_points[original].tolist()})
    cloth = np.array(parts["cape_cloth"]["positions"]).reshape(161, 19, 3)
    back = [material.insert(cloth[column, 0]) for column in range(161)]
    fronts = {}
    for name, column in [("cape_front_edge_0", 0), ("cape_front_edge_1", 160)]:
        centers = [material.insert(cloth[column, row]) for row in range(19)]
        source = np.array(parts[name]["positions"]).reshape(19, 13, 3)
        radial = []
        for row in range(19):
            ids = []
            for sample in range(1, 13):
                ids.append(len(material.positions))
                material.positions.append(source[row, sample].tolist())
            radial.append(ids)
        fronts[name] = {"centers": centers, "radial": radial}
    positions, cells, vertices, inverse = material.arrays()
    source = [parts[name] for name in ["cape_cloth", "cape_back_edge", "cape_hem"]]
    queries = np.concatenate([coarse_points] + [
        np.array(part["positions"]).reshape(-1, 3) for part in source])
    low, high = vertices.min(axis=1)-1e-7, vertices.max(axis=1)+1e-7
    selections, weights, worst = [], [], 1.0
    for point in queries:
        # A fixed number of nearest centroids can miss long, thin cells.
        near = np.flatnonzero(((point >= low) & (point <= high)).all(axis=1))
        assert len(near), "No cell bounding the source point"
        bary = np.einsum('kij,kj->ki', inverse[near], point - vertices[near, 0])
        bary = np.c_[1-bary.sum(axis=1), bary]
        scores = bary.min(axis=1)
        selected = scores.argmax()
        worst = min(worst, float(scores[selected]))
        selections.append(int(near[selected]))
        weights.append(bary[selected].tolist())
    assert len(positions) <= 2048 and len(cells) <= 4096 and worst >= -1e-6
    volumes = np.linalg.det(np.transpose(vertices[:, 1:] - vertices[:, :1], (0, 2, 1))) / 6
    assert volumes.min() > 1e-10
    certificate = {
        "particles": len(positions), "cells": len(cells), "pins": len(pins),
        "frontParticles": 456, "insertionsByFeatureSize": material.feature_counts,
        "minimumCellVolume": float(volumes.min()), "minimumBarycentric": worst,
    }
    return {
        "schema": "bubu-shared-surface-cage/1", "attachmentProfile": PROFILE,
        "positions": positions.astype(np.float32).ravel().tolist(),
        "cells": cells.ravel().tolist(), "sections": sections, "sourceParts": source,
        "pins": pins, "pinRecords": records, "backCenters": back, "fronts": fronts,
        "referenceBinding": {"cells": selections[:len(coarse_points)],
                             "weights": weights[:len(coarse_points)]},
        "certificate": certificate,
        "inputHashes": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in inputs},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists(), "Choose a new external output file"
    assert not args.output.resolve().is_relative_to(ROOT.parent), "Output must be external to research sources"
    result = author()
    with args.output.open("x") as target:
        json.dump(result, target, separators=(",", ":"))
    print(result["certificate"])
