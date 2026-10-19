from pathlib import Path
exec((Path(__file__).resolve().parent/'audit.py').read_text().split('frames=[];moving={}')[0])
def vertices(m):return np.array(m['positions']).reshape(-1,3) if 'positions' in m else np.fromfile(m['positionsFile'],dtype='<f4').reshape(-1,3)
def mesh_at(f,n):return {**d['sharedMeshes'].get(n,{}),**next(m for m in f['meshes'] if m['name']==n)}
poses=json.load(open(OUT/'motion.json'));runtime=[]
for f,s in zip(d['frames'],poses):
 for n,h in [('Bubu_hand-left','handL'),('Bubu_hand-right','handR')]:
  a=vertices(mesh_at(d['frames'][0],n));b=vertices(mesh_at(f,n));M=np.array(s['matrices'][h]).reshape(4,4).T
  runtime.append({'t':f['time'],'name':n,'maxPositionError':float(abs(a@M[:3,:3].T+M[:3,3]-b).max())})
def contact_count(tri,delta):return sum(len(c.intersections(tri+delta)) for c in cs.values())
results=[]
for t in [.6,1.5,3.4]:
 f=next(f for f in d['frames'] if f['time']==t)
 for n in ['Bubu_hand-left','Bubu_hand-right','Sip_cup_shell']:
  m=mesh_at(f,n)
  if m.get('opacity',1)<=0:continue
  tri=vertices(m)[np.array(m['indices']).reshape(-1,3)]
  # Forward-only rigid displacement; no shape, source, or runtime writes.
  direction=np.array([0,0,1]);last=0.;found=None
  for shift in np.arange(.01,.601,.01):
   count=contact_count(tri,shift*direction)
   if count==0:found=float(shift);break
   last=float(shift)
  if found:
   lo,hi=last,found
   for _ in range(10):
    mid=(lo+hi)/2
    if contact_count(tri,mid*direction):lo=mid
    else:hi=mid
   # Bound for globally separated projections along forward axis (sufficient, not minimum).
   upper=max(c.t[:,:,2].max() for c in cs.values())-tri[:,:,2].min()
   results.append({'t':t,'name':n,'direction':[0,0,1],'firstSampledSurfaceClearBracket':[lo,hi],'coarseStep':.01,'strictProjectionSeparationShift':float(upper),'warning':'First clear along sampled forward-only ray, not global minimum, margin, or containment guarantee.'})
  else:results.append({'t':t,'name':n,'noSurfaceClearThrough':.6})
print(json.dumps({'runtime':runtime,'forwardOnly':results},indent=2));(OUT/'displacement-report.json').write_text(json.dumps({'runtimeCoordinateProof':runtime,'forwardOnly':results},indent=2))
