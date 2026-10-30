"""Opt-in projective/active-set cloth solve; no production registration.

The global QP solves inertia/material, all affine seams, fixed supports and
active real-surface contacts together. Hard strain blocks use ADMM; positive
cell orientation is preserved along every update. Input geometry stays frozen.
"""
import numpy as np
from scipy import sparse
import osqp
from positive_volume import positive_step
from coupled_acceleration import AndersonProposal


class CoupledCloth:
    def __init__(self, discretization, contact, dt=1/120, max_iterations=60, strain_method="active", accelerate=False):
        self.accelerate = accelerate
        if accelerate and strain_method!="active": raise ValueError("Acceleration requires the active strain method")
        self.strain_method = strain_method
        self.d, self.contact, self.dt = discretization, contact, dt
        self.max_iterations = max_iterations
        self.x = self.d['rest'].copy()
        self.v = np.zeros_like(self.x)
        self.free = np.setdiff1d(np.arange(len(self.x)), self.d['pins'])
        self.pins = self.d['pins']
        self.blocks, operators, penalties, offsets = {}, [], [], []
        inverse_mass = 1/self.d['masses']
        inverse_mass[self.pins] = 0
        def effective_penalty(operator):
            diagonal = operator.multiply(operator)@inverse_mass
            return np.divide(1/self.dt**2, diagonal, out=np.zeros_like(diagonal), where=diagonal>1e-20)
        def add(name, operator, penalty, offset):
            start = sum(len(v) for v in penalties)
            penalty = np.broadcast_to(penalty, operator.shape[0]).copy()
            self.blocks[name] = slice(start, start+len(penalty))
            operators.append(operator); penalties.append(penalty); offsets.append(offset)
        density = self.d['masses'].sum()/self.d['volumes'].sum()
        modulus = density*(2*np.pi*30*.08)**2
        add('material', self.d['deformation'], np.repeat(modulus*self.d['volumes'], 3),
            np.zeros((self.d['deformation'].shape[0], 3)))
        a, b = self.d['physical_pairs'].T
        reduced = self.d['masses'][a]*self.d['masses'][b]/(self.d['masses'][a]+self.d['masses'][b])
        add('elastic', self.d['physical'], reduced*(2*np.pi*30*.08)**2,
            np.zeros((self.d['physical'].shape[0], 3)))
        self.shape_weights = np.concatenate([g['masses']*(2*np.pi*30*g['radius'])**2 for g in self.d['shape_groups']])
        add('shape', self.d['shape'], self.shape_weights, np.zeros((self.d['shape'].shape[0], 3)))
        for name in (() if strain_method=='active' else ('physical', 'rendered')):
            operator = self.d[name]
            add(name, operator, effective_penalty(operator),
                self.d['render_offset'] if name=='rendered' else np.zeros((operator.shape[0], 3)))
        self.A = sparse.vstack(operators, format='csr')
        self.weight = np.concatenate(penalties)
        self.offset = np.concatenate(offsets)
        self.rest_values = self.A@self.x+self.offset
        self.inertia = self.d['masses']/self.dt**2
        matrix = sparse.diags(self.inertia)+self.A.T@sparse.diags(self.weight)@self.A
        matrix = matrix[self.free][:, self.free]
        self.P = sparse.triu(sparse.block_diag([matrix]*3, format='csc'), format='csc')
        self.C = sparse.block_diag([self.d['centroid'][:, self.free]]*3, format='csc')
        self.dual = np.zeros((self.A.shape[0], 3))
        self.rest_volume = self.volume(self.x)
        assert np.all(self.rest_volume>0)
        self.shape_batches = []
        span = self.blocks['shape']
        for count in sorted(set(g['count'] for g in self.d['shape_groups'])):
            groups = [g for g in self.d['shape_groups'] if g['count']==count]
            indices = np.array([np.arange(span.start+g['start'], span.start+g['start']+count) for g in groups])
            self.shape_batches.append((indices, np.array([g['rest'] for g in groups]), np.array([g['masses'] for g in groups])))
        self.problem = None
        self.contact_keys = None
        self.last = None
        self.active_contacts = {}
        self.constraint_values = None

    def volume(self, x):
        p = x[self.d['cells']]
        return np.linalg.det(np.transpose(p[:, 1:]-p[:, :1], (0, 2, 1)))/6

    def render(self, x=None):
        return self.d['mapping']@(self.x if x is None else x)+self.d['offset']

    @staticmethod
    def proper_rotation(values):
        u, _, vt = np.linalg.svd(values)
        flip = np.linalg.det(u@vt)<0
        u[flip, :, -1] *= -1
        return u@vt

    def project_blocks(self, q):
        z = q.copy()
        span = self.blocks['material']
        z[span] = self.proper_rotation(q[span].reshape(-1, 3, 3)).reshape(-1, 3)
        span = self.blocks['elastic']
        length = np.linalg.norm(q[span], axis=1)
        if np.any(length<1e-14): raise ArithmeticError('Collapsed elastic edge')
        z[span] = q[span]/length[:, None]
        for indices, rest, masses in self.shape_batches:
            covariance = np.einsum('gni,gn,gnj->gij', rest, masses, q[indices])
            rotation = self.proper_rotation(covariance)
            z[indices] = np.einsum('gni,gij->gnj', rest, rotation)
        for name in (() if self.strain_method=='active' else ('physical', 'rendered')):
            span = self.blocks[name]
            length = np.linalg.norm(q[span], axis=1)
            if np.any(length<1e-14): raise ArithmeticError('Collapsed strain constraint')
            z[span] = q[span]*(np.clip(length, .800001, 1.199999)/length)[:, None]
        return z

    def global_solve(self, rhs, activation):
        vertices, normal, offset, keys = self.contact.linear_constraints(self.render(), activation)
        for key, n, b in zip(keys, normal, offset):
            self.active_contacts[key] = (n, b)
        keys = tuple(sorted(self.active_contacts))
        vertices = np.array([key[1] for key in keys], dtype=int)
        normal = np.array([self.active_contacts[key][0] for key in keys]).reshape(-1, 3)
        offset = np.array([self.active_contacts[key][1] for key in keys])
        mapping = self.d['mapping'][vertices][:, self.free]
        contacts = sparse.hstack([mapping.multiply(normal[:, k, None]) for k in range(3)], format='csc')
        constraint = sparse.vstack([self.C, contacts], format='csc')
        bound = -offset-np.einsum('ij,ij->i', self.d['source'][vertices], normal)
        lower = np.concatenate([np.zeros(self.C.shape[0]), bound])
        upper = np.concatenate([np.zeros(self.C.shape[0]), np.full(len(vertices), np.inf)])
        if self.strain_method=='active':
            from coupled_strain import strain_halfspaces
            strain_matrix, strain_lower, strain_upper, strain_keys = strain_halfspaces(self.d, self.x, self.free)
            constraint = sparse.vstack([constraint, strain_matrix], format='csc')
            lower = np.concatenate([lower, strain_lower])
            upper = np.concatenate([upper, strain_upper])
            keys += strain_keys
        q = -rhs[self.free].T.reshape(-1)
        if self.problem is None or self.contact_keys!=keys:
            self.problem = osqp.OSQP()
            self.problem.setup(P=self.P, q=q, A=constraint, l=lower, u=upper,
                               verbose=False, eps_abs=1e-8, eps_rel=1e-8, max_iter=4000,
                               polishing=False, check_termination=10, scaled_termination=False)
            self.problem.warm_start(x=(self.x[self.free]-self.d['rest'][self.free]).T.reshape(-1))
            self.contact_keys = keys
            self.constraint_values = constraint.data.copy()
        else:
            if np.array_equal(constraint.data, self.constraint_values):
                self.problem.update(q=q, l=lower, u=upper)
            else:
                self.problem.update(q=q, l=lower, u=upper, Ax=constraint.data)
                self.constraint_values = constraint.data.copy()
        result = self.problem.solve(raise_error=False)
        if result.x is None or not np.isfinite(result.x).all() or result.info.status_val not in (1, 2, 7):
            raise ArithmeticError('Coupled QP failed: '+result.info.status)
        candidate = self.d['rest'].copy()
        candidate[self.free] += result.x.reshape(3, -1).T
        return candidate, {'status': result.info.status, 'iterations': result.info.iter,
                           'primal': result.info.prim_res, 'dual': result.info.dual_res,
                           'contactConstraints': len(vertices)}

    def residuals(self, x):
        lengths = [np.linalg.norm(self.d['physical']@x, axis=1),
                   np.linalg.norm(self.d['rendered']@x+self.d['render_offset'], axis=1)]
        contact, active = self.contact.residual(self.render(x))
        return {'minimumStrain': float(min(v.min() for v in lengths)),
                'maximumStrain': float(max(v.max() for v in lengths)),
                'minimumVolumeRatio': float((self.volume(x)/self.rest_volume).min()),
                'centroidResidual': float(np.max(np.linalg.norm(self.d['centroid']@(x-self.d['rest']), axis=1))),
                'pinResidual': float(np.max(np.linalg.norm(x[self.pins]-self.d['rest'][self.pins], axis=1))),
                'contactCorrection': contact, 'activeContactFeatures': active}

    def energy(self, x, prediction):
        ax = self.A@x+self.offset
        z = self.project_blocks(ax)
        return float(.5*np.sum(self.inertia[:, None]*(x-prediction)**2)+
                     .5*np.sum(self.weight[:, None]*(ax-z)**2))

    @staticmethod
    def feasible(r):
        return (r['minimumStrain']>=.8 and r['maximumStrain']<=1.2 and
                r['contactCorrection']<1e-7 and r['centroidResidual']<1e-8 and
                r['pinResidual']<1e-8 and r['minimumVolumeRatio']>0)

    def step(self, poses, gravity=(0, -9.81, 0)):
        self.contact.update(poses)
        self.active_contacts = {}
        old = self.x.copy()
        prediction = old+self.dt*self.v+self.dt**2*np.asarray(gravity)
        inertial_rhs = self.inertia[:, None]*(prediction-self.d['rest'])
        activation = max(float(np.max(np.linalg.norm(prediction-old, axis=1))), 1e-6)
        minimum_alpha, converged = 1.0, False
        accelerator = AndersonProposal()
        accelerated = 0
        for iteration in range(self.max_iterations):
            prior = self.x.copy()
            ax = self.A@self.x+self.offset
            z = self.project_blocks(ax+self.dual)
            rhs = inertial_rhs+self.A.T@(self.weight[:, None]*(z-self.dual-self.rest_values))
            candidate, qp = self.global_solve(rhs, activation)
            direction = candidate-self.x
            alpha = positive_step(self.x, direction, self.d['cells'], self.rest_volume*1e-6)
            if alpha<2**-30: raise ArithmeticError('Positive-volume progress exhausted')
            self.x += alpha*direction
            minimum_alpha = min(minimum_alpha, alpha)
            if self.accelerate and np.max(np.linalg.norm(direction, axis=1))>=1e-7:
                proposed = accelerator.propose(prior, self.x)
                if proposed is not None and np.isfinite(proposed).all():
                    step = positive_step(self.x, proposed-self.x, self.d['cells'], self.rest_volume*1e-6)
                    proposed = self.x+step*(proposed-self.x)
                    if (self.feasible(self.residuals(proposed)) and
                            self.energy(proposed, prediction)<self.energy(self.x, prediction)):
                        self.x = proposed
                        accelerated += 1
            residual = self.A@self.x+self.offset-z
            for name in (() if self.strain_method=='active' else ('physical', 'rendered')):
                span = self.blocks[name]
                self.dual[span] += residual[span]
            if iteration%5==4 or iteration==self.max_iterations-1:
                r = self.residuals(self.x)
                converged = (r['minimumStrain']>=.8 and r['maximumStrain']<=1.2 and
                             r['contactCorrection']<1e-7 and r['centroidResidual']<1e-8 and
                             r['minimumVolumeRatio']>0 and qp['primal']<1e-7 and
                             max(np.max(np.linalg.norm(direction, axis=1)), np.max(np.linalg.norm(self.x-prior, axis=1)))<1e-7)
                if converged: break
        self.v = (self.x-old)/self.dt
        r = self.residuals(self.x)
        r.update(iterations=iteration+1, acceleratedSteps=accelerated, incrementalEnergy=self.energy(self.x, prediction), converged=bool(converged), minimumLineSearch=minimum_alpha,
                 kineticEnergy=float(.5*np.sum(self.d['masses'][:, None]*self.v**2)),
                 maximumSpeed=float(np.linalg.norm(self.v, axis=1).max()), qp=qp,
                 lastPositionUpdate=float(np.max(np.linalg.norm(direction, axis=1))), productionAccepted=False)
        self.last = r
        return r
