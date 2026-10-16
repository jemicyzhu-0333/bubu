from pathlib import Path
import runpy,json,numpy as np
P=Path(__file__).parent;m=runpy.run_path(str(P/'audit_export_identity.py'));load,acc,meshes=m['load'],m['acc'],m['meshes'];g,b=load(P/'bubu-a05-selected-faces.glb');old,ob=load(next(q/'bubu-3d-a-face-selected05-20261016/candidate-a05-selected-faces-r5/bubu-a05-selected-faces.glb' for q in P.parents if (q/'bubu-3d-a-face-selected05-20261016/candidate-a05-selected-faces-r5/bubu-a05-selected-faces.glb').is_file()));mm,om=meshes(g),meshes(old);rows={};same={}
def signed_xy(a,idx):
 t=a[idx][:,:,:2];u=t[:,1]-t[:,0];v=t[:,2]-t[:,0];return u[:,0]*v[:,1]-u[:,1]*v[:,0]
for name,mesh in mm.items():
 if name=='A_mochi_skin':continue
 p=mesh['primitives'][0];orig=acc(g,b,p['attributes']['POSITION']);idx=acc(g,b,p['indices']).reshape(-1,3);base=signed_xy(orig,idx);names=mesh['extras']['targetNames'];oo=om[name]['primitives'][0];onames=om[name]['extras']['targetNames'];same[name]={}
 for st in ['01']:
  same[name][st]=all(np.array_equal(acc(g,b,p['targets'][names.index(f'Face{st}_{k:02}')]['POSITION']),acc(old,ob,oo['targets'][onames.index(f'Face{st}_{k:02}')]['POSITION'])) for k in range(1,9))
 for st in ['01','04','05','07','08']:
  ds=[np.zeros_like(orig)]+[acc(g,b,p['targets'][names.index(f'Face{st}_{k:02}')]['POSITION']) for k in range(1,9)]
  for i in range(81):
   a=i/80;j=min(7,int(a*8));t=a*8-j;q=orig+ds[j]*(1-t)+ds[j+1]*t;area=signed_xy(q,idx);flips=int(((base*area)<-1e-12).sum());near=int((np.abs(area)<1e-10).sum());rows[f'{name}/{st}/{a:.4f}']={'projectedOrientationReversals':flips,'nearZeroProjectedTriangles':near}
report={'method':'XY projection sign relative to own neutral front cap; detects fold-over candidates, not a general self-intersection proof. Closed highlights intentionally collapse.','unchanged01Targets':same,'samples':rows,'anyOrientationReversal':any(r['projectedOrientationReversals'] for r in rows.values())};(P/'face-orientation-audit.json').write_text(json.dumps(report,indent=2));print('FLIPS',report['anyOrientationReversal']);print([(k,r) for k,r in rows.items() if r['projectedOrientationReversals']][:10]);print('01 unchanged',all(v for r in same.values() for v in r.values()))
