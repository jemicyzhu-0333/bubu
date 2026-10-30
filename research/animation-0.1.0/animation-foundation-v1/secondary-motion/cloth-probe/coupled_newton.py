"""Opt-in consistent material/seam/contact Newton research candidate.

Owns no application state. Source geometry and controller remain read-only.
Finite or locally converged steps never confer production admission.
"""
import numpy as np
from scipy import sparse
import osqp
from coupled_solver import CoupledCloth
from coupled_volume import cell_barrier
from coupled_polar import corotated_system
from coupled_sections import shape_system, edge_system
from coupled_rounding import strain_halfspaces, contact_rounding_guard
from positive_volume import positive_step


class CoupledNewton(CoupledCloth):
    def __init__(self, discretization, contact, dt=1/120, max_iterations=120,
                 strain_method='active', accelerate=False):
        if strain_method!='active' or accelerate:
            raise ValueError('Newton uses exact active constraints, without projective acceleration')
        super().__init__(discretization, contact, dt, max_iterations, strain_method, accelerate)
        self.modulus = self.d['masses'].sum()/self.d['volumes'].sum()*(2*np.pi*30*.08)**2

    def solve_position(self, prediction):
        d, free, x = self.d, self.free, self.x
        material, material_gradient = corotated_system(d, x, free, self.modulus)
        sections, section_gradient = shape_system(d, x, free, self.shape_weights)
        edges, edge_gradient = edge_system(d, x, free, self.weight[self.blocks['elastic']])
        elastic = material+sections+edges
        gradient = material_gradient+section_gradient+edge_gradient
        barrier_energy, barrier, force, volume_rows, volume_bounds, volume_keys = cell_barrier(
            x, d['rest'], d['cells'], self.rest_volume, free, self.modulus)
        displacement = (x[free]-d['rest'][free]).T.reshape(-1)
        inertia = np.tile(self.inertia[free], 3)
        metric = sparse.triu(sparse.diags(inertia)+elastic+barrier, format='csc')
        rhs = inertia*(prediction[free]-d['rest'][free]).T.reshape(-1)+elastic@displacement-gradient+force
        # Historical separating planes are not additional physical contacts.
        # Re-select current planes and check every actual triangle afterwards.
        vertices, normals, offsets, keys = self.contact.linear_constraints(self.render(), 1e-6)
        mapping = d['mapping'][vertices][:, free]
        contact_rows = sparse.hstack([mapping.multiply(normals[:, k, None]) for k in range(3)], format='csc')
        contact_bounds = -offsets-np.einsum('ij,ij->i', d['source'][vertices], normals)
        obstacle_radius = np.array([self.contact.rounding_radii[key[0]] for key in keys]).reshape(-1, 3)
        guard = contact_rounding_guard(self.render()[vertices], normals, obstacle_radius, 1e-8)
        contact_bounds += guard
        strain_rows, strain_lower, strain_upper, _ = strain_halfspaces(d, x, free)
        constraints = sparse.vstack([self.C, contact_rows, strain_rows, volume_rows], format='csc')
        lower = np.r_[np.zeros(self.C.shape[0]), contact_bounds, strain_lower, volume_bounds]
        upper = np.r_[np.zeros(self.C.shape[0]), np.full(len(keys), np.inf), strain_upper, np.full(len(volume_keys), np.inf)]
        problem = osqp.OSQP()
        # Polishing follows the bounded linear solve. Original geometric and
        # nonlinear convergence gates are checked independently after it. The
        # fixed adaptation interval avoids a wall-clock-selected solver path.
        problem.setup(P=metric, q=-rhs, A=constraints, l=lower, u=upper, verbose=False,
                      eps_abs=1e-8, eps_rel=0, max_iter=4000, polishing=True,
                      check_termination=10, scaled_termination=False, adaptive_rho_interval=50)
        problem.warm_start(x=displacement)
        result = problem.solve(raise_error=False)
        if result.x is None or not np.isfinite(result.x).all() or result.info.status_val not in (1, 2, 7):
            raise ArithmeticError('Newton QP failed: '+result.info.status)
        candidate = d['rest'].copy()
        candidate[free] += result.x.reshape(3, -1).T
        return candidate, dict(status=result.info.status, iterations=result.info.iter,
                              primal=result.info.prim_res, dual=result.info.dual_res,
                              contactConstraints=len(keys), contactRoundingGuard=float(guard.max(initial=0)),
                              barrierCells=len(volume_keys), barrierEnergy=barrier_energy)

    def residuals(self, x):
        result = super().residuals(x)
        rendered = self.render(x).astype(np.float32).astype(float)
        a, b = self.d['render_pairs'].T
        length = np.linalg.norm(rendered[b]-rendered[a], axis=1)/self.d['render_lengths']
        result.update(minimumActualStrain=float(length.min()), maximumActualStrain=float(length.max()))
        result['actualSupportCorrection'] = self.contact.residual(rendered)[0]
        return result

    def energy(self, x, prediction):
        barrier = cell_barrier(x, self.d['rest'], self.d['cells'], self.rest_volume, self.free, self.modulus)[0]
        return super().energy(x, prediction)+barrier

    def step(self, poses, gravity=(0, -9.81, 0)):
        self.contact.update(poses)
        old = self.x.copy()
        prediction = old+self.dt*self.v+self.dt**2*np.asarray(gravity)
        minimum_alpha, converged = 1.0, False
        for iteration in range(self.max_iterations):
            candidate, qp = self.solve_position(prediction)
            direction = candidate-self.x
            alpha = positive_step(self.x, direction, self.d['cells'], self.rest_volume*1e-6)
            # Interior-point fraction-to-boundary, not a post-solve position or
            # velocity clamp: avoid evaluating a singular barrier at its edge.
            if alpha<1: alpha *= .8
            if alpha<2**-30: raise ArithmeticError('Positive-volume progress exhausted')
            self.x += alpha*direction
            minimum_alpha = min(minimum_alpha, alpha)
            if iteration%5==4 or iteration==self.max_iterations-1:
                r = self.residuals(self.x)
                converged = (self.feasible(r) and r['minimumActualStrain']>=.8 and
                             r['maximumActualStrain']<=1.2 and r['actualSupportCorrection']<1e-10 and qp['status']=='solved' and
                             qp['primal']<1e-7 and np.max(np.linalg.norm(direction, axis=1))<1e-7)
                if converged: break
        self.v = (self.x-old)/self.dt
        r = self.residuals(self.x)
        r.update(iterations=iteration+1, converged=bool(converged), minimumLineSearch=minimum_alpha,
                 kineticEnergy=float(.5*np.sum(self.d['masses'][:, None]*self.v**2)),
                 maximumSpeed=float(np.linalg.norm(self.v, axis=1).max()), qp=qp,
                 incrementalEnergy=self.energy(self.x, prediction),
                 lastPositionUpdate=float(np.max(np.linalg.norm(direction, axis=1))), productionAccepted=False)
        self.last = r
        return r
