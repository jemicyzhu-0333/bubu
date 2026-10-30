"""Active linearizations of every physical and rendered edge-length bound.

Inactive inequalities are checked after every global solve. The upper tangent
plane is only a necessary constraint; acceptance uses the exact nonlinear norm.
The lower tangent halfspace is sufficient, locally selecting a noncollapsed
orientation. Neither changes the original [0.8, 1.2] acceptance interval.
"""
import numpy as np
from scipy import sparse


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
        lower.extend(np.where(lengths[active]<.805, .800001-baseline, -np.inf))
        upper.extend(np.where(lengths[active]>1.195, 1.199999-baseline, np.inf))
        keys.extend((name, int(i), int(lengths[i]>1)) for i in active)
    return sparse.vstack(matrices, format='csc'), np.array(lower), np.array(upper), tuple(keys)
