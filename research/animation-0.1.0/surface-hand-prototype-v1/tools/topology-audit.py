import json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parent;j=json.loads((P/'base.json').read_text());m=next(m for m in j['frames'][0]['meshes'] if m['name']=='A_mochi_skin');tris=np.array(m['indices']).reshape(-1,3);patches=json.loads((P/'patches.json').read_text());out=[]
for p in patches:
 ids=set(p['vertices']);ts=np.array([t for t in tris if all(int(v) in ids for v in t)]);edges,counts=np.unique(np.sort(np.concatenate([ts[:,[0,1]],ts[:,[1,2]],ts[:,[2,0]]]),axis=1),axis=0,return_counts=True);boundary=edges[counts==1];adj={}
 for x,y in boundary:adj.setdefault(int(x),set()).add(int(y));adj.setdefault(int(y),set()).add(int(x))
 unseen=set(adj);loops=0
 while unseen:
  loops+=1;stack=[unseen.pop()]
  while stack:
   for v in adj[stack.pop()]:
    if v in unseen:unseen.remove(v);stack.append(v)
 out.append({'side':p['side'],'vertices':len(np.unique(ts)),'edges':len(edges),'triangles':len(ts),'eulerCharacteristic':len(np.unique(ts))-len(edges)+len(ts),'boundaryLoops':loops,'boundaryDegrees':sorted(set(map(len,adj.values()))),'nonManifoldEdges':int(sum(counts>2))})
(P/'topology-audit.json').write_text(json.dumps(out,indent=2));print(out)
