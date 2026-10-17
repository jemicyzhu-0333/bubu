import numpy as np,json
from pathlib import Path
P=Path(__file__).resolve().parent;j=json.loads((P/'base.json').read_text());m=next(m for m in j['frames'][0]['meshes'] if m['name']=='A_mochi_skin');tri=np.array(m['indices']).reshape(-1,3);rows=[]
def segment(start,end,b):
 d=end-start;e1=b[1]-b[0];e2=b[2]-b[0];p=np.cross(d,e2);det=e1@p
 if abs(det)<1e-16:return None
 inv=1/det;s=start-b[0];u=(s@p)*inv;r=np.cross(s,e1);v=(d@r)*inv;t=(e2@r)*inv
 if t>1e-8 and t<1-1e-8 and u>1e-8 and v>1e-8 and u+v<1-1e-8:return {'t':t,'u':u,'v':v,'point':(start+t*d).tolist()}
for r in json.loads((P/'fan-audit.json').read_text()):
 label=str(int(r['t'])) if r['t']==1 else str(r['t']);q=np.load(P/f'audit-{label}.npy')
 for i,k in r['hitExamples']:
  hits=[]
  for ti,tj in [(tri[i],tri[k]),(tri[k],tri[i])]:
   for e in range(3):
    h=segment(q[ti[e]],q[ti[(e+1)%3]],q[tj])
    if h:hits.append(h)
  rows.append({'t':r['t'],'triangles':[i,k],'float64StrictInteriorHits':hits,'commonVertices':list(map(int,set(tri[i])&set(tri[k])))})
(P/'fan-hit-confirmation.json').write_text(json.dumps(rows,indent=2));print(rows)
