"""Whole-triangle separating halfspaces for unchanged convex obstacle proxies.

Projection is a local block of the coupled solve, never a display correction.
An endpoint result is not a continuous-motion certificate. All surfaces still
require exact original-mesh intersection checks in the independent verifier.
"""
import numpy as np
from scipy.spatial import ConvexHull


class ConvexContact:
    def __init__(self, obstacles, triangles):
        self.triangles = np.asarray(triangles, dtype=int)
        self.templates = {}
        self.current = []
        self.planes = {}
        for obstacle in obstacles:
            points = np.asarray(obstacle['positions']).reshape(-1, 3)
            origin = points.mean(axis=0)
            _, singular, basis = np.linalg.svd(points-origin, full_matrices=False)
            if singular[-1] < 1e-12*max(singular[0], 1):
                if singular[1] < 1e-12: raise ValueError('Degenerate obstacle')
                # A zero-thickness convex surface has two supporting face
                # planes and its exact in-plane edge planes. No extrusion.
                projected = (points-origin)@basis[:2].T
                hull = ConvexHull(projected)
                normals = hull.equations[:, :2]@basis[:2]
                offsets = hull.equations[:, 2]-normals@origin
                face = basis[2]
                equations = np.vstack([np.column_stack([normals, offsets]),
                    np.r_[face, -face@origin], np.r_[-face, face@origin]])
            else:
                hull = ConvexHull(points)
                equations = hull.equations
            _, keep = np.unique(np.round(equations, 10), axis=0, return_index=True)
            self.templates[obstacle['name']] = (equations[keep], points[hull.vertices])

    def update(self, poses):
        self.current = []
        self.rounding_radii = {}
        self.refresh_linear_planes = True
        for pose in poses:
            if not pose['visible']: continue
            equations, points = self.templates[pose['name']]
            matrix = np.asarray(pose['matrix']).reshape(4, 4).T
            linear, translation = matrix[:3, :3], matrix[:3, 3]
            normal = equations[:, :3]@np.linalg.inv(linear)
            offset = equations[:, 3]-normal@translation
            length = np.linalg.norm(normal, axis=1)
            normal, offset = normal/length[:, None], offset/length
            world = points@linear.T+translation
            # Affine extrema occur at hull vertices. This bounds conversion of
            # every transformed source vertex, including non-hull vertices.
            from coupled_rounding import float32_half_ulp
            self.rounding_radii[pose['name']] = float32_half_ulp(
                np.max(np.abs(world), axis=0))
            self.current.append((pose['name'], normal, offset, world.min(axis=0), world.max(axis=0)))

    def project(self, positions):
        out = positions.copy()
        active = 0
        tri = self.triangles
        for name, normal, offset, low, high in self.current:
            if np.any(out.max(axis=0) < low) or np.any(out.min(axis=0) > high): continue
            if name not in self.planes:
                self.planes[name] = np.zeros(len(tri), dtype=int)
            plane = self.planes[name]
            ns = normal[plane]
            score = np.min(np.einsum('tvi,ti->tv', out[tri], ns)+offset[plane, None], axis=1)
            unresolved = np.flatnonzero(score < 0)
            # A previously separating support plane is an exact certificate,
            # not nearest-feature pruning. Search every facet only where that
            # certificate no longer holds. No obstacle planes are discarded.
            for start in range(0, len(unresolved), 128):
                selected = unresolved[start:start+128]
                points = out[tri[selected]]
                values = np.min(points@normal.T+offset, axis=1)
                plane[selected] = values.argmax(axis=1)
                score[selected] = values[np.arange(len(selected)), plane[selected]]
            bad = score < 0
            if not np.any(bad): continue
            ids = tri[bad].reshape(-1)
            ns = np.repeat(normal[plane[bad]], 3, axis=0)
            ds = np.repeat(offset[plane[bad]], 3)
            active += int(bad.sum())
            for _ in range(12):
                gap = np.einsum('ij,ij->i', out[ids], ns)+ds
                violated = gap < -1e-10
                if not violated.any(): break
                correction = np.zeros_like(out)
                count = np.zeros(len(out))
                np.add.at(correction, ids[violated], -gap[violated, None]*ns[violated])
                np.add.at(count, ids[violated], 1)
                selected = count > 0
                out[selected] += correction[selected]/count[selected, None]
        return out, active

    def residual(self, positions):
        projected, active = self.project(positions)
        return float(np.max(np.linalg.norm(projected-positions, axis=1))), active

    def linear_constraints(self, positions, activation):
        """Exact separating planes for an active-set global position QP.

        Activation controls which constraints enter early, not collision size:
        every inequality still uses the original support plane at zero depth.
        A complete residual check discovers any newly violated triangle.
        """
        tri = self.triangles
        selected = {}
        for name, normal, offset, low, high in self.current:
            if np.any(positions.max(axis=0)+activation < low) or np.any(positions.min(axis=0)-activation > high): continue
            if name not in self.planes: self.planes[name] = np.zeros(len(tri), dtype=int)
            plane = self.planes[name]
            score = np.min(np.einsum('tvi,ti->tv', positions[tri], normal[plane])+offset[plane, None], axis=1)
            unresolved = np.flatnonzero(score < (activation if self.refresh_linear_planes else 0))
            for start in range(0, len(unresolved), 128):
                ids = unresolved[start:start+128]
                values = np.min(positions[tri[ids]]@normal.T+offset, axis=1)
                plane[ids] = values.argmax(axis=1)
                score[ids] = values[np.arange(len(ids)), plane[ids]]
            for triangle, face in zip(tri[score<activation], plane[score<activation]):
                for vertex in triangle:
                    selected[(name, int(vertex), int(face))] = (normal[face], offset[face])
        self.refresh_linear_planes = False
        keys = tuple(sorted(selected))
        return (np.array([k[1] for k in keys], dtype=int),
                np.array([selected[k][0] for k in keys]).reshape(-1, 3),
                np.array([selected[k][1] for k in keys]), keys)
