"""First-positive-volume interval for a straight global solver update."""
import numpy as np


def triple(a, b, c):
    return np.einsum('ij,ij->i', a, np.cross(b, c))


def positive_step(positions, direction, cells, minimum_volumes):
    p, d = positions[cells], direction[cells]
    p, d = p[:, 1:]-p[:, :1], d[:, 1:]-d[:, :1]
    a, b, c = np.transpose(p, (1, 0, 2))
    x, y, z = np.transpose(d, (1, 0, 2))
    c0 = triple(a, b, c)-6*minimum_volumes
    c1 = triple(x, b, c)+triple(a, y, c)+triple(a, b, z)
    c2 = triple(x, y, c)+triple(x, b, z)+triple(a, y, z)
    c3 = triple(x, y, z)
    if np.any(c0 <= 0): raise ArithmeticError('Update starts outside positive-volume domain')
    def evaluate(t): return ((c3*t+c2)*t+c1)*t+c0
    candidates = [np.ones(len(c0))]
    discriminant = 4*c2*c2-12*c3*c1
    quadratic = (np.abs(c3)>1e-30)&(discriminant>=0)
    root = np.sqrt(np.maximum(discriminant, 0))
    for sign in (-1, 1):
        values = np.full(len(c0), np.inf)
        np.divide(-2*c2+sign*root, 6*c3, out=values, where=quadratic)
        candidates.append(values)
    linear = (~quadratic)&(np.abs(c2)>1e-30)
    values = np.full(len(c0), np.inf)
    np.divide(-c1, 2*c2, out=values, where=linear)
    candidates.append(values)
    end = 1.0
    found = False
    for t in candidates:
        inside = (t>0)&(t<=1)
        # Do not evaluate an infinite critical point.
        safe = np.where(inside, t, 0)
        bad = inside&(evaluate(safe)<=0)
        if np.any(bad): end=min(end, float(t[bad].min())); found=True
    if not found: return 1.0
    begin = 0.0
    for _ in range(48):
        middle = (begin+end)/2
        if np.all(evaluate(middle)>0): begin=middle
        else: end=middle
    return begin*(1-1e-6)
