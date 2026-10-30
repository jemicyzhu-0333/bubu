"""Behavior contracts for a disabled numerical candidate, not path acceptance."""
import importlib.util
import json
from pathlib import Path
import unittest
import numpy as np
from coupled_surface import build_discretization
from coupled_contact import ConvexContact
from coupled_solver import CoupledCloth
from coupled_strain import strain_halfspaces
from coupled_acceleration import AndersonProposal
from positive_volume import positive_step
from coupled_newton import CoupledNewton
from coupled_polar import corotated_system
from coupled_sections import shape_system, edge_system
from coupled_volume import cell_barrier
from coupled_rounding import render_rounding_margin, float32_half_ulp, contact_rounding_guard

HERE = Path(__file__).resolve().parent


class VolumeGuard(unittest.TestCase):
    def setUp(self):
        self.x = np.array([[0.,0,0],[1,0,0],[0,1,0],[0,0,1]])
        self.cells = np.array([[0,1,2,3]])

    def test_translation_and_rotation_endpoints(self):
        self.assertEqual(positive_step(self.x, np.ones_like(self.x), self.cells, np.array([1e-9])), 1)
        target = self.x@np.diag([-1.,-1,1])
        # Both endpoint determinants are positive; the path collapses midway.
        alpha = positive_step(self.x, target-self.x, self.cells, np.array([1e-9]))
        self.assertGreater(alpha, .49)
        self.assertLess(alpha, .5)

    def test_linear_collapse_and_invalid_start(self):
        direction = np.zeros_like(self.x); direction[3,2] = -2
        alpha = positive_step(self.x, direction, self.cells, np.array([1e-9]))
        self.assertLess(alpha, .5)
        self.assertGreater(alpha, .49)
        with self.assertRaises(ArithmeticError):
            positive_step(self.x[[0,2,1,3]], direction, self.cells, np.array([1e-9]))


class ContactGeometry(unittest.TestCase):
    def setUp(self):
        self.cube = np.array([[x,y,z] for x in (-1.,1) for y in (-1.,1) for z in (-1.,1)])
        self.contact = ConvexContact([{'name':'cube','positions':self.cube.reshape(-1)}], [[0,1,2]])
        self.pose = {'name':'cube','visible':True,'matrix':np.eye(4).T.reshape(-1)}
        self.contact.update([self.pose])

    def test_edge_crossing_with_all_vertices_outside(self):
        x = np.array([[-2.,0,0],[2,0,0],[0,2,0]])
        self.assertTrue(np.all(np.max(np.abs(x),axis=1)>1))
        residual, active = self.contact.residual(x)
        self.assertGreater(residual, 0)
        self.assertGreater(active, 0)
        projected, _ = self.contact.project(x)
        self.assertLess(self.contact.residual(projected)[0], 1e-9)

    def test_cached_certificate_and_transformed_obstacle(self):
        outside = np.array([[2.,0,0],[2,1,0],[2,0,1]])
        self.assertEqual(self.contact.residual(outside)[0], 0)

        self.assertEqual(self.contact.residual(outside)[0], 0)
        m = np.eye(4); m[:3,3] = [2,0,0]
        self.contact.update([dict(self.pose,matrix=m.T.reshape(-1))])
        self.assertGreater(self.contact.residual(outside)[0], 0)
        self.contact.update([dict(self.pose,visible=False)])
        self.assertEqual(self.contact.residual(outside)[0], 0)

    def test_planar_cup_surface_keeps_zero_thickness_contact(self):
        points = np.array([[-1.,-1,0],[-1,1,0],[1,-1,0],[1,1,0]])
        contact = ConvexContact([{'name':'cube','positions':points.reshape(-1)}], [[0,1,2]])
        contact.update([self.pose])
        self.assertEqual(contact.residual(np.array([[0.,0,.01],[.5,0,.01],[0,.5,.01]]))[0],0)
        self.assertGreater(contact.residual(np.array([[0.,0,-.1],[.5,0,.1],[0,.5,.1]]))[0],0)

    def test_contact_guard_covers_rounding_of_both_actual_surfaces(self):
        rng = np.random.default_rng(608333)
        obstacle = rng.uniform(-2, 2, (256, 3))
        normals = rng.normal(size=(256, 3))
        normals /= np.linalg.norm(normals, axis=1)[:, None]
        tangent = rng.normal(size=(256, 3))
        tangent -= np.einsum('ij,ij->i', tangent, normals)[:, None]*normals
        touching = obstacle+tangent
        def gap(points):
            return np.einsum('ij,ij->i', points.astype(np.float32).astype(float)-
                             obstacle.astype(np.float32).astype(float), normals)
        # Exact double contact can become penetration in the actual buffers.
        self.assertLess(gap(touching).min(), -1e-8)
        guard = contact_rounding_guard(touching, normals, float32_half_ulp(obstacle), 1e-8)
        self.assertTrue(np.all(gap(touching+guard[:, None]*normals)>0))
        # The bound follows coordinate precision, not a global collider radius.
        self.assertLess(guard.max(), 1e-6)


class FullDiscretization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('shared_cage',HERE/'author-shared-surface-cage.py')
        author = importlib.util.module_from_spec(spec); spec.loader.exec_module(author)
        cls.data = author.author()
        cls.parts = json.loads((HERE/'../../integration/diagnostics/contact-contract-20261019/frozen-cape.json').read_text())['parts']
        cls.d = build_discretization(cls.data, cls.parts)

    def test_all_cells_mass_constraints_and_source_vertices_retained(self):
        d = self.d
        self.assertEqual(len(d['rest']),1983); self.assertEqual(len(d['cells']),3760)
        self.assertEqual(len(d['pins']),51); self.assertEqual(d['centroid'].shape[0],201)
        self.assertEqual(len(d['shape_groups']),364); self.assertEqual(len(d['physical_pairs']),8364)
        self.assertAlmostEqual(d['masses'].sum(), .444, places=7)
        self.assertTrue(np.all(d['volumes']>0))
        np.testing.assert_allclose(d['mapping']@d['rest']+d['offset'], d['source'], atol=1e-14, rtol=0)
        np.testing.assert_allclose((d['deformation']@d['rest']).reshape(-1,3,3), np.broadcast_to(np.eye(3),(3760,3,3)), atol=1e-10, rtol=0)

    def test_render_mapping_translation_and_local_front_response(self):
        d = self.d; translation = np.array([.12,-.08,.03])
        np.testing.assert_allclose(d['mapping']@(d['rest']+translation)+d['offset'],d['source']+translation,atol=1e-12,rtol=0)
        x = d['rest'].copy(); particle = self.data['fronts']['cape_front_edge_0']['radial'][7][4]
        x[particle] += [0,0,.001]
        changed = d['mapping']@(x-d['rest'])
        front = next(r for r in d['ranges'] if r['name']=='cape_front_edge_0')
        np.testing.assert_allclose(changed[front['start']+7*13+5], [0,0,.001],atol=1e-14,rtol=0)

    def test_zero_force_rest_has_no_energy_injection(self):
        solver = CoupledCloth(self.d,ConvexContact([],self.d['triangles']),max_iterations=20,accelerate=True)
        row = solver.step([],gravity=(0,0,0))
        self.assertTrue(row['converged'])
        self.assertLess(row['kineticEnergy'],1e-15)
        self.assertFalse(row['productionAccepted'])
        self.assertEqual(row['pinResidual'],0)
        np.testing.assert_allclose(solver.x,self.d['rest'],atol=1e-10,rtol=0)

    def test_strain_linearization_detects_exact_expansion(self):
        d=self.d; free=np.arange(len(d['rest'])); x=d['rest']*1.25
        matrix,low,high,keys=strain_halfspaces(d,x,free)
        displacement=(x-d['rest']).T.reshape(-1)
        self.assertGreater(len(keys),10000)
        self.assertTrue(np.any(matrix@displacement>high))
        matrix,low,high,keys=strain_halfspaces(d,d['rest'],free)
        self.assertEqual(len(keys),0)

    def test_consistent_all_material_gradient_and_positive_curvature(self):
        d=self.d; solver=CoupledNewton(d,ConvexContact([],d['triangles']))
        x=d['rest']@np.array([[1.015,.01,0],[0,.99,.004],[0,0,1.02]])
        free=solver.free
        H,g=corotated_system(d,x,free,solver.modulus)
        for h,f in [shape_system(d,x,free,solver.shape_weights),
                    edge_system(d,x,free,solver.weight[solver.blocks['elastic']])]:
            H+=h; g+=f
        direction=np.random.default_rng(730).normal(size=x.shape)
        direction[d['pins']]=0; direction/=np.linalg.norm(direction)
        y=direction[free].T.reshape(-1)
        def energy(x):
            q=solver.A@x+solver.offset; z=solver.project_blocks(q)
            return .5*np.sum(solver.weight[:,None]*(q-z)**2)
        eps=1e-7
        numerical=(energy(x+eps*direction)-energy(x-eps*direction))/(2*eps)
        self.assertAlmostEqual(float(g@y),numerical,delta=max(abs(numerical)*1e-5,1e-8))
        self.assertGreaterEqual(float(y@(H@y)),0)
        self.assertLess(np.max(np.abs((H-H.T).data),initial=0),1e-8)

    def test_interior_barrier_has_consistent_force_and_no_rest_energy(self):
        d=self.d; free=np.arange(len(d['rest'])); x=d['rest']@np.diag([.3,.5,1])
        value,H,force,_,_,keys=cell_barrier(x,d['rest'],d['cells'],d['volumes'],free,100)
        self.assertGreater(value,0); self.assertEqual(len(keys),3760)
        direction=np.random.default_rng(731).normal(size=x.shape);direction/=np.linalg.norm(direction)
        y=direction.T.reshape(-1);gradient=H@(x-d['rest']).T.reshape(-1)-force
        def energy(x):return cell_barrier(x,d['rest'],d['cells'],d['volumes'],free,100)[0]
        eps=1e-7;numerical=(energy(x+eps*direction)-energy(x-eps*direction))/(2*eps)
        self.assertAlmostEqual(float(gradient@y),numerical,delta=max(abs(numerical)*1e-5,1e-8))
        self.assertEqual(energy(d['rest']),0)

    def test_rounding_bound_covers_actual_float32_rendered_edges(self):
        d=self.d;x=d['rest']*1.2
        exact=d['mapping']@x+d['offset'];actual=exact.astype(np.float32).astype(float)
        a,b=d['render_pairs'].T
        difference=np.abs(np.linalg.norm(actual[b]-actual[a],axis=1)-
                          np.linalg.norm(exact[b]-exact[a],axis=1))/d['render_lengths']
        margin=render_rounding_margin(d,x)
        self.assertTrue(np.all(difference<=margin))
        self.assertGreater(margin.max(),1e-6,'A fixed 1e-6 strain cushion does not cover all rendered edges')

    def test_newton_rest_is_finite_stationary_and_unadmitted(self):
        solver=CoupledNewton(self.d,ConvexContact([],self.d['triangles']),max_iterations=10)
        row=solver.step([],gravity=(0,0,0))
        self.assertTrue(row['converged']);self.assertFalse(row['productionAccepted'])
        self.assertLess(row['kineticEnergy'],1e-15)
        self.assertEqual(row['pinResidual'],0)

    def test_barrier_resists_tangent_collapse_missed_by_gradient_outer_product(self):
        rest=np.array([[0.,0,0],[1,0,0],[0,1,0],[0,0,1]])
        x=rest.copy();x[1,0]=.1
        direction=np.zeros((4,3));direction[1,1]=1;direction[2,0]=1
        _,H,force,_,_,_=cell_barrier(x,rest,np.array([[0,1,2,3]]),np.array([1/6]),np.arange(4),1)
        gradient=H@(x-rest).T.reshape(-1)-force;y=direction.T.reshape(-1)
        # J(t)=0.1-t^2: the first derivative vanishes, but the tangent collapses
        # the cell. A gradient-only barrier Hessian incorrectly assigns zero.
        self.assertLess(abs(float(gradient@y)),1e-12)
        self.assertGreater(float(y@(H@y)),.16)

    def test_unforced_relaxation_does_not_inject_mechanical_energy(self):
        solver=CoupledNewton(self.d,ConvexContact([],self.d['triangles']))
        first=solver.step([])
        energy=solver.energy(solver.x,solver.x)+first['kineticEnergy']
        self.assertGreater(energy,0)
        for _ in range(4):
            row=solver.step([],gravity=(0,0,0))
            current=solver.energy(solver.x,solver.x)+row['kineticEnergy']
            self.assertTrue(row['converged'])
            self.assertLessEqual(current,energy+1e-9)
            energy=current


class AccelerationProposal(unittest.TestCase):
    def test_contracting_affine_map_and_constraints(self):
        proposal=AndersonProposal()
        x=np.array([[0.,1,0],[0,1,0]])
        target=np.array([[1.,1,0],[-1,1,0]])
        result=None
        for _ in range(3):
            mapped=.9*x+.1*target
            accelerated=proposal.propose(x,mapped)
            x=mapped if accelerated is None else accelerated
            result=x
        np.testing.assert_allclose(result,target,atol=1e-8)
        np.testing.assert_allclose(result.mean(axis=0),[0,1,0],atol=1e-14)


if __name__=='__main__': unittest.main()
