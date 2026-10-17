import json,numpy as np,hashlib
from pathlib import Path
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent;B=json.loads((P/'base.json').read_text());bm=next(m for m in B['frames'][0]['meshes'] if m['name']=='A_mochi_skin');a=np.array(bm['positions']).reshape(-1,3);tri=np.array(bm['indices']).reshape(-1,3);original=BVHTree.FromPolygons(a.tolist(),tri.tolist(),all_triangles=True,epsilon=0);allrows=[]
def pos(m):return np.fromfile(m['positionsFile'],dtype='<f4').reshape(-1,3).astype(float)
for file in json.loads((P/'geometry-manifests.json').read_text()):
 file=Path(file);data=json.loads(file.read_text());rows=[];defs={m['name']:m for m in data['frames'][0]['meshes']}
 for i,f in enumerate(data['frames']):
  q=pos(next(m for m in f['meshes'] if m['name']=='A_mochi_skin'));tree=BVHTree.FromPolygons(q.tolist(),tri.tolist(),all_triangles=True,epsilon=0);faces={m['name']:BVHTree.FromPolygons(pos(m).tolist(),np.array(m.get('indices',defs[m['name']]['indices'])).reshape(-1,3).tolist(),all_triangles=True,epsilon=0) for m in f['meshes'] if not m['name'].startswith('Sip_') and not m['name'].startswith('Steam_') and m['name']!='A_mochi_skin'};newface={n:len(set(tree.overlap(ft))-set(original.overlap(ft))) for n,ft in faces.items()};selfpairs=[(j,k) for j,k in tree.overlap(tree) if j<k and not set(tri[j])&set(tri[k])];cross={};facecross={};inside=0
  if f['cue']['cupScale']>1e-6:
   for m in f['meshes']:
    if not m['name'].startswith('Sip_'):continue
    ct=BVHTree.FromPolygons(pos(m).tolist(),np.array(m.get('indices',defs[m['name']]['indices'])).reshape(-1,3).tolist(),all_triangles=True,epsilon=0);cross[m['name']]=len(tree.overlap(ct));facecross[m['name']]=sum(len(ft.overlap(ct)) for ft in faces.values())
   R=f['cupParameters']['cupRadius'];H=f['cupParameters']['cupHeight'];local=(q-np.array(f['cupCenter']))@np.array(f['cupRotation'])/f['cue']['cupScale'];h=local[:,1];rho=np.linalg.norm(local[:,[0,2]],axis=1);outer=np.interp(h,[0,.025,H-.025,H],[R*.73,R*.8,R,R*.99]);inner=np.interp(h,[.05,H-.025,H],[R*.7,R*.86,R*.88]);inside=int(((h>0)&(h<H)&(rho<outer)&((h<.05)|(rho>inner))).sum())
  steamPairs=0;steamCupPairs=0
  for sm in f['meshes']:
   if not sm['name'].startswith('Steam_') or sm.get('opacity',0)<=1e-6:continue
   st=BVHTree.FromPolygons(pos(sm).tolist(),np.array(sm.get('indices',defs[sm['name']]['indices'])).reshape(-1,3).tolist(),all_triangles=True,epsilon=0);steamPairs+=len(tree.overlap(st))+sum(len(ft.overlap(st)) for ft in faces.values())
   cm=next(mm for mm in f['meshes'] if mm['name']=='Sip_cup_shell');ct=BVHTree.FromPolygons(pos(cm).tolist(),np.array(cm.get('indices',defs[cm['name']]['indices'])).reshape(-1,3).tolist(),all_triangles=True,epsilon=0);steamCupPairs+=len(ct.overlap(st))
  row={'steamBodyFacePairs':steamPairs,'steamCeramicPairs':steamCupPairs,'frame':i,'time':f['time'],'phase':f['cue']['phase'],'facePath':f['faceState']['path'],'faceAmount':f['faceState']['amount'],'cupBodyPairs':cross,'cupFacePairs':facecross,'newBodyFacePairs':newface,'nonAdjacentBodySelfPairs':len(selfpairs),'ceramicInsideBodyVertices':inside,'feetMaxDelta':float(np.linalg.norm(q[a[:,1]<.4]-a[a[:,1]<.4],axis=1).max()),'finite':bool(np.isfinite(q).all())};rows.append(row)
  bad=sum(cross.values())+sum(facecross.values())+sum(newface.values())+len(selfpairs)+inside+steamPairs+steamCupPairs
  if bad:print('FAIL',file.stem,row,flush=True)
 result={'name':file.stem,'inputSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'sampleCount':len(rows),'rows':rows};allrows.append(result);print('DONE',file.stem,len(rows),'violations',sum(sum(r['cupBodyPairs'].values())+sum(r['cupFacePairs'].values())+sum(r['newBodyFacePairs'].values())+r['nonAdjacentBodySelfPairs']+r['ceramicInsideBodyVertices'] for r in rows),flush=True)
(P/'full-audit.json').write_text(json.dumps({'scope':'normal271 samples@30fps over0..9 inclusive; nine cancellation points with7 offset samples each. No continuous safety proof; shared-vertex fan adjacency excluded. Face actual approved08 owner event path. All cup render geometry included if scale>1e-6','runs':allrows},indent=2))
