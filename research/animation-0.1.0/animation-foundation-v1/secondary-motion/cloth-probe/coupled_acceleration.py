"""Bounded Anderson proposal; the caller must enforce energy and feasibility.

This has no acceptance authority. It proposes an affine combination of recent
global solves, preserving affine support/seam constraints up to roundoff.
"""
import numpy as np


class AndersonProposal:
    def __init__(self, depth=5):
        self.depth = depth
        self.history = []

    def propose(self, previous, mapped):
        self.history.append((mapped.copy(), (mapped-previous).reshape(-1)))
        self.history = self.history[-self.depth:]
        if len(self.history)<2: return None
        residuals = np.array([row[1] for row in self.history])
        gram = residuals@residuals.T
        scale = np.trace(gram)
        if not np.isfinite(scale) or scale<1e-30: return None
        gram += np.eye(len(gram))*scale*1e-12
        try: weights = np.linalg.solve(gram, np.ones(len(gram)))
        except np.linalg.LinAlgError: return None
        total = weights.sum()
        if abs(total)<1e-20: return None
        weights /= total
        if not np.isfinite(weights).all() or np.max(np.abs(weights))>10: return None
        return np.einsum('i,ijk->jk', weights, np.array([row[0] for row in self.history]))
