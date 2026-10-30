"""Active linearizations of every physical and rendered edge-length bound.

Inactive inequalities are checked after every global solve. The upper tangent
plane is only a necessary constraint; acceptance uses the exact nonlinear norm.
The lower tangent halfspace is sufficient, locally selecting a noncollapsed
orientation. Neither changes the original [0.8, 1.2] acceptance interval.
"""
import numpy as np
from scipy import sparse


def float32_half_ulp(positions):
    """Per-coordinate error bound for the actual float32 output conversion."""
    rounded = np.asarray(positions).astype(np.float32)
    up = np.nextafter(rounded, np.float32(np.inf)).astype(float)-rounded
    down = rounded.astype(float)-np.nextafter(rounded, np.float32(-np.inf)).astype(float)
    return np.maximum(up, down)*.5


def contact_rounding_guard(positions, normals, obstacle_radius, linear_tolerance):
    """Bound both surfaces' quantization and the linear solve residual.

    This is a numerical separation bound, not a new collider radius or relaxed
    intersection tolerance. The independent original-triangle gate stays exact.
    """
    return np.einsum('ij,ij->i', np.abs(normals),
                     float32_half_ulp(positions)+obstacle_radius)+linear_tolerance


def render_rounding_margin(d,x):
    render=d['mapping']@x+d['offset']
    radius=np.linalg.norm(float32_half_ulp(render),axis=1)
    a,b=d['render_pairs'].T
    return (radius[a]+radius[b])/d['render_lengths']+1e-7


def strain_halfspaces(d, x, free):
    matrices, lower, upper, keys = [], [], [], []
    for name in ('physical', 'rendered'):
        operator = d[name]
        offset = d['render_offset'] if name=='rendered' else 0
        values = operator@x+offset
        lengths = np.linalg.norm(values, axis=1)
        if np.any(lengths<1e-14): raise ArithmeticError('Collapsed strain edge')
        active = np.flatnonzero((lengths<.805)|(lengths>1.195))
        normals = values[active]/lengths[active, None]
        rows = operator[active][:, free]
        matrices.append(sparse.hstack([rows.multiply(normals[:, k, None]) for k in range(3)]))
        rest = operator[active]@d['rest']
        if name=='rendered': rest += offset[active]
        baseline = np.einsum('ij,ij->i', normals, rest)
        margin=render_rounding_margin(d,x)[active] if name=='rendered' else 1e-6
        lower.extend(np.where(lengths[active]<.805, .8+margin-baseline, -np.inf))
        upper.extend(np.where(lengths[active]>1.195, 1.2-margin-baseline, np.inf))
        keys.extend((name, int(i), int(lengths[i]>1)) for i in active)
    return sparse.vstack(matrices, format='csc'), np.array(lower), np.array(upper), tuple(keys)
