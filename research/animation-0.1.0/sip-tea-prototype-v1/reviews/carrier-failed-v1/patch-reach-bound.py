import json,numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from pathlib import Path
D=Path(__file__).resolve().parent
p=json.load(open(D/'experiment-frames.json'));m=next(x for x in p['frames'][0]['meshes'] if x['name']=='A_mochi_skin');a=np.array(m['positions']).reshape(-1,3);t=np.array(m['indices']).reshape(-1,3)
e=np.unique(np.sort(np.concatenate([t[:,[0,1]],t[:,[1,2]],t[:,[2,0]]]),axis=1),axis=0)
inside=(abs(a[:,0])>.72)&(a[:,1]>.43)&(a[:,1]<.98)&(a[:,2]>-.38)&(a[:,2]<.40)
cross=e[inside[e[:,0]]!=inside[e[:,1]]];boundary=np.unique(cross[inside[cross]])
# All graph paths are valid length upper bounds; shortest paths improve this test.
l=np.linalg.norm(a[e[:,0]]-a[e[:,1]],axis=1);G=coo_matrix((np.r_[l,l],(np.r_[e[:,0],e[:,1]],np.r_[e[:,1],e[:,0]])),shape=(len(a),len(a))).tocsr()
d,pred,src=dijkstra(G,indices=boundary,directed=False,min_only=True,return_predecessors=True)
s=json.load(open(D/'space-measurement.json'));out=[]
for side,deg in [('L',75),('R',-65)]:
 verts=s['bounds']['Shoulder_'+side]['vertices'];ids=np.array([v['i'] for v in verts if v['weight']>.95 and inside[v['i']]],int)
 for amount in [.25,.7,1]:
  th=np.deg2rad(deg*amount);q=a[ids].copy();q[:,0]=a[ids,0]*np.cos(th)+a[ids,2]*np.sin(th);q[:,2]=-a[ids,0]*np.sin(th)+a[ids,2]*np.cos(th)
  target=np.linalg.norm(q-a[src[ids]],axis=1);ratio=target/d[ids];i=int(np.argmax(ratio));rec=dict(side=side,amount=amount,finCount=len(ids),boundaryCount=len(boundary),violations=int(np.count_nonzero(ratio>1.35)),maxRequiredEdgeStretch=float(ratio[i]),finVertex=int(ids[i]),boundaryVertex=int(src[ids[i]]),originalPathLength=float(d[ids[i]]),targetStraightDistance=float(target[i]));out.append(rec)
print(json.dumps(out,indent=2));(D/'patch-reach-bound.json').write_text(json.dumps(out,indent=2))
