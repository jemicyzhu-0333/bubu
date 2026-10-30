"""External-evidence adapter for the opt-in coupled solver, never runtime admission."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import traceback
import sys
from importlib.metadata import version
import numpy as np
from coupled_surface import build_discretization
from coupled_contact import ConvexContact
from coupled_solver import CoupledCloth
from positive_volume import positive_step


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--cage', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--path', choices=['normal', 'cancel02'], default='normal')
    parser.add_argument('--frames', type=int)
    parser.add_argument('--iterations', type=int, default=120)
    parser.add_argument('--method', choices=['projective','newton'], default='projective')
    parser.add_argument('--accelerate', action='store_true')
    parser.add_argument('--strain-method', choices=['active','admm'], default='active')
    args = parser.parse_args()
    source_root = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    assert not output.is_relative_to(source_root) and not output.exists()
    assert 1 <= args.iterations <= 1000
    inputs = json.loads(args.input.read_text())
    data = json.loads(args.cage.read_text())
    frozen = json.loads((source_root/'animation-foundation-v1/integration/diagnostics/contact-contract-20261019/frozen-cape.json').read_text())
    assert inputs['parts']==frozen['parts'] and inputs['sourceModelSHA256']==frozen['sha256']
    for name, expected in inputs['sourceHashes'].items():
        target = (source_root/name).resolve()
        assert target.is_relative_to(source_root) and hashlib.sha256(target.read_bytes()).hexdigest()==expected
    for name, expected in data['inputHashes'].items():
        target = (source_root/'animation-foundation-v1'/name).resolve()
        assert target.is_relative_to(source_root) and hashlib.sha256(target.read_bytes()).hexdigest()==expected
    trajectory = inputs['paths'][args.path]
    frames = args.frames or trajectory['horizon']['frames']
    assert 1 <= frames <= trajectory['horizon']['frames']
    output.mkdir()
    source_files = [Path(__file__).with_name(name) for name in
                    ['coupled_probe.py', 'coupled_solver.py', 'coupled_surface.py', 'coupled_contact.py', 'positive_volume.py', 'coupled_strain.py', 'coupled_acceleration.py', 'coupled_newton.py', 'coupled_volume.py', 'coupled_polar.py', 'coupled_sections.py', 'coupled_rounding.py']]
    hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files+[args.input, args.cage]}
    report = {'status': 'running', 'productionAccepted': False, 'candidateEnabledByDefault': False,
              'scope': 'Coupled research dynamics, exact frozen sources; original-surface verifier remains required',
              'path': args.path, 'method':args.method, 'strainMethod': args.strain_method, 'accelerate':args.accelerate, 'horizon': trajectory['horizon'], 'requestedFrames': frames,
              'sourceHashes': hashes, 'versions':{name:version(name) for name in ['numpy','scipy','osqp']},
              'python':sys.version, 'rows': [], 'limits': {'strain': [.8, 1.2], 'seam': 1e-5, 'pin': 1e-5},
              'limitations': ['No self-contact or general continuous trajectory proof', 'Python CPU candidate; not native GPU acceptance']}
    def save(): (output/'coupled-cloth.json').write_text(json.dumps(report, indent=2))
    save()
    start = time.perf_counter()
    try:
        d = build_discretization(data, inputs['parts'])
        contact = ConvexContact(inputs['obstacles'], d['triangles'])
        from coupled_newton import CoupledNewton
        solver_type = CoupledNewton if args.method=='newton' else CoupledCloth
        solver = solver_type(d, contact, dt=1/trajectory['horizon']['sampleHz'], max_iterations=args.iterations, strain_method=args.strain_method, accelerate=args.accelerate)
    except Exception as error:
        report.update(status='failed', failure=str(error), phase='construction', reachedActionEndpoint=False)
        save()
        raise
    report['constructionSeconds'] = time.perf_counter()-start
    report['counts'] = {'particles': len(d['rest']), 'cells': len(d['cells']), 'seams': d['centroid'].shape[0],
                        'shapeGroups': len(d['shape_groups']), 'pins': len(d['pins']),
                        'renderVertices': len(d['source']), 'physicalEdges': len(d['physical_pairs'])}
    print('constructed', report['constructionSeconds'], report['counts'], flush=True)
    snapshots = {26, 259, frames}
    def parts_at(rendered):
        return [dict(name=p['name'], positions=(rendered[next(r for r in d['ranges'] if r['name']==p['name'])['start']:
                    next(r for r in d['ranges'] if r['name']==p['name'])['start']+len(p['positions'])//3].reshape(-1).tolist()
                    if p['name']!='cape_clasp' else p['positions']), indices=p['indices']) for p in inputs['parts']]
    try:
        with (output/'particles.f64').open('wb') as physical, (output/'rendered.f32').open('wb') as render_file:
            for i, frame in enumerate(trajectory['frames'][1:frames+1], 1):
                previous = solver.x.copy()
                begin = time.perf_counter()
                row = solver.step(frame['obstacles'])
                row['solveMs'] = (time.perf_counter()-begin)*1000
                rendered = solver.render().astype(np.float32)
                assert np.isfinite(solver.x).all() and np.isfinite(rendered).all()
                strain = np.linalg.norm(rendered[d['render_pairs'][:, 1]].astype(float)-rendered[d['render_pairs'][:, 0]], axis=1)/d['render_lengths']
                row['actualRenderStrain'] = [float(strain.min()), float(strain.max())]
                parts = {r['name']: rendered[r['start']:r['start']+r['count']] for r in d['ranges']}
                seams = []
                for name in ['cape_back_edge', 'cape_hem', 'cape_front_edge_0', 'cape_front_edge_1']:
                    rings = parts[name].reshape(-1, 13, 3)[:, 1:].astype(float).mean(axis=1)
                    cloth = parts['cape_cloth'].reshape(161, 19, 3)
                    edge = cloth[:, 0] if name=='cape_back_edge' else cloth[:, -1] if name=='cape_hem' else cloth[0] if name.endswith('_0') else cloth[-1]
                    seams.extend(np.linalg.norm(rings-edge, axis=1))
                row['actualSeam'] = float(max(seams))
                row['interpolatedCellsPositive'] = positive_step(previous, solver.x-previous, d['cells'], solver.rest_volume*1e-6)==1
                row['time'] = frame['time']; row['frame'] = i-1
                row['totalWithMeasurementsMs'] = (time.perf_counter()-begin)*1000
                report['rows'].append(row)
                solver.x.tofile(physical); rendered.tofile(render_file)
                if i in snapshots:
                    (output/f'frame-{i}-render-parts.json').write_text(json.dumps(parts_at(rendered)))
                    np.savez(output/f'frame-{i}-state.npz', positions=solver.x, velocities=solver.v)
                if i%10==0 or i==1:
                    save(); print('frame', i, row, flush=True)
        report['status'] = 'completed'
        report['reachedActionEndpoint'] = frames==trajectory['horizon']['frames']
    except Exception as error:
        report.update(status='failed', failure=str(error), traceback=traceback.format_exc(), reachedActionEndpoint=False)
        print(report['traceback'], flush=True)
    finally:
        (output/'last-render-parts.json').write_text(json.dumps(parts_at(solver.render().astype(np.float32))))
        np.savez(output/'last-state.npz', positions=solver.x, velocities=solver.v)
        rows = report['rows']
        report['gates'] = {
            'allRequestedStepsFinite':len(rows)==frames,
            'allStepsConverged':bool(rows) and all(row['converged'] for row in rows),
            'physicalAndRenderedStrain':bool(rows) and all(row['minimumStrain']>=.8 and row['maximumStrain']<=1.2 and row['actualRenderStrain'][0]>=.8 and row['actualRenderStrain'][1]<=1.2 for row in rows),
            'seamsAndPins':bool(rows) and all(row['actualSeam']<=1e-5 and row['pinResidual']<=1e-5 for row in rows),
            'positiveCellsAndInterpolation':bool(rows) and all(row['minimumVolumeRatio']>0 and row['interpolatedCellsPositive'] for row in rows),
            'proxyContact':bool(rows) and all(row['contactCorrection']<1e-7 for row in rows),
            'actualMeshContact':'not-run', 'continuousContact':'not-established',
            'nativeGPU':'not-run', 'productionAccepted':False,
        }
        report['sourcesUnchanged'] = all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in hashes.items())
        save()
    if report['status']=='failed': raise SystemExit(1)


if __name__=='__main__': main()
