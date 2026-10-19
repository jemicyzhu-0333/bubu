from pathlib import Path
exec((Path(__file__).resolve().parent/'audit.py').read_text().split('frames=[];moving={}')[0])
report=json.load(open(OUT/'contact-report.json'));out=[]
def point_triangle_distance(p,t):
 a,b,c=t[:,0],t[:,1],t[:,2];ab=b-a;ac=c-a;ap=p-a
 d00=(ab*ab).sum(1);d01=(ab*ac).sum(1);d11=(ac*ac).sum(1);d20=(ap*ab).sum(1);d21=(ap*ac).sum(1);den=d00*d11-d01*d01
 u=np.divide(d11*d20-d01*d21,den,out=np.zeros_like(den),where=abs(den)>1e-20);v=np.divide(d00*d21-d01*d20,den,out=np.zeros_like(den),where=abs(den)>1e-20)
 projection=a+u[:,None]*ab+v[:,None]*ac;dist=np.linalg.norm(p-projection,axis=1);dist[(u<0)|(v<0)|(u+v>1)|(abs(den)<1e-20)]=np.inf
 for x,y in [(a,b),(b,c),(c,a)]:
  e=y-x;ee=(e*e).sum(1);q=np.clip(np.divide(((p-x)*e).sum(1),ee,out=np.zeros_like(ee),where=ee>1e-20),0,1)
  dist=np.minimum(dist,np.linalg.norm(p-x-q[:,None]*e,axis=1))
 return float(dist.min())
for t in [1.5,3.4]:
 f=next(f for f in d['frames'] if f['time']==t);r=next(f for f in report['frames'] if f['time']==t)
 for n,record in r['pinsInsideHands'].items():
  m={**d['sharedMeshes'].get(n,{}),**next(m for m in f['meshes'] if m['name']==n)};vs=np.fromfile(m['positionsFile'],dtype='<f4').reshape(-1,3);tri=vs[np.array(m['indices']).reshape(-1,3)]
  depths=[point_triangle_distance(np.array(p),tri) for p in record['positions']]
  out.append({'time':t,'name':n,'pinParticleIds':record['pinParticleIds'],'depths':depths,'necessaryRigidTranslationNormLowerBound':max(depths)})
# Resolve topology ordering difference in old cached clasp.
s=next(m for m in static['frames'][0]['meshes'] if m['name']=='cape_clasp');a=np.array(s['indices']).reshape(-1,3);b=np.array(cape['cape_clasp']['indices']).reshape(-1,3)
canonical=lambda x:sorted(map(tuple,np.sort(x,axis=1)))
result={'pinDepths':out,'claspUnorientedTriangleSetsIdentical':canonical(a)==canonical(b),'interpretation':'Minimum hand-boundary distance for each pinned point currently inside a hand. Maximum depth is a necessary lower bound on rigid hand translation magnitude, not a sufficient displacement or a global correction.'}
(OUT/'pin-depth-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
