"""Private collision-skin experiment. Does not write approved assets."""
import argparse,hashlib,json,pathlib,numpy as np
from scipy.spatial import cKDTree
catalogue_path=pathlib.Path(__file__).with_name('attachment-profiles.json')
catalogue=json.loads(catalogue_path.read_bytes())
parser=argparse.ArgumentParser();parser.add_argument('--output',type=pathlib.Path,required=True);parser.add_argument('--refine-boundary',action='store_true');parser.add_argument('--cloth-region',action='store_true');parser.add_argument('--attachment-profile',choices=tuple(catalogue['profiles']),default='tea-swept-51-v1');args=parser.parse_args()
assert not args.cloth_region or args.refine_boundary
r=pathlib.Path(__file__).resolve().parents[2]
assert not args.output.exists(), 'Choose a new external output file'
assert not args.output.resolve().is_relative_to(r.parents[0]), 'Output must be external to research sources'
c=json.load((r/'secondary-motion/cloth-probe/cape-coarse.json').open()); b=json.load((r/'secondary-motion/cloth-probe/cape-binding.json').open()); f=json.load((r/'integration/diagnostics/contact-contract-20261019/frozen-cape.json').open())
assert hashlib.sha256((r/'secondary-motion/cloth-probe/cape-coarse.json').read_bytes()).hexdigest()==catalogue['simulationSHA256'], 'Cape simulation identity changed'
p=np.array(c['positions']).reshape(-1,3); tris=np.array(c['indices']).reshape(-1,3)
extra_pins=[]
if args.refine_boundary:
 uv=[]
 for column,rows in enumerate(c['grid']['rowsPerColumn']):
  uv.extend([(column/c['grid']['cols'],row/rows)for row in range(rows+1)])
 uv=np.array(uv);edges={}
 for ids in tris:
  for a,z in zip(ids,np.roll(ids,-1)):
   key=tuple(sorted((int(a),int(z))));edges[key]=edges.get(key,0)+1
 cloth=np.array(next(x for x in f['parts']if x['name']=='cape_cloth')['positions']).reshape(161,19,3)
 targets=[(i/160,0,cloth[i,0])for i in range(161)]+[(i/160,1,cloth[i,18])for i in range(161)]+[(0,j/18,cloth[0,j])for j in range(19)]+[(1,j/18,cloth[160,j])for j in range(19)]
 positions=p.tolist();triangles=tris.tolist()
 for (a,z),count in edges.items():
  if count!=1:continue
  delta=uv[z]-uv[a];length=delta@delta;insert=[]
  for u,v,point in targets:
   relative=np.array([u,v])-uv[a];t=relative@delta/length
   if 1e-9<t<1-1e-9 and np.linalg.norm(relative-t*delta)<1e-9:insert.append((t,point))
  if not insert:continue
  source=next(ids for ids in triangles if a in ids and z in ids);triangles.remove(source)
  opposite=next(i for i in source if i not in [a,z]);forward=source[(source.index(a)+1)%3]==z
  chain=[a]
  for _,point in sorted(insert,key=lambda x:x[0]):
   index=len(positions);positions.append(point.tolist());chain.append(index)
   if a in c['pins'] and z in c['pins']:extra_pins.append({'index':index,'parents':[a,z]})
  chain.append(z)
  for left,right in zip(chain,chain[1:]):triangles.append([left,right,opposite]if forward else[right,left,opposite])
 p=np.array(positions);tris=np.array(triangles)
n=len(p)
norm=np.zeros_like(p); boundary={}
for ids in tris:
 a,z,d=p[ids]; normal=np.cross(z-a,d-a)
 for i in ids:norm[i]+=normal
 for a,z in zip(ids,np.roll(ids,-1)):
  key=tuple(sorted((int(a),int(z))))
  if key in boundary:boundary[key]=None
  else:boundary[key]=(int(a),int(z))
norm/=np.linalg.norm(norm,axis=1)[:,None]
# Enclose the existing rest detail in a private cage. Collision occurs only on
# the original detailed skin, never on this expanded simulation volume.
margin=b['maxOffset']+.01
extension=np.zeros_like(p)
for edge in boundary.values():
 if edge is None:continue
 a,z=edge; tangent=p[z]-p[a]; normal=(norm[a]+norm[z])/2; outward=np.cross(tangent,normal);outward/=np.linalg.norm(outward)
 extension[a]+=outward;extension[z]+=outward
mask=np.linalg.norm(extension,axis=1)>0
extension[mask]/=np.linalg.norm(extension[mask],axis=1)[:,None]
center=p if args.cloth_region else p+extension*margin
positions=np.concatenate([center-norm*margin,center+norm*margin]).astype(np.float32)
cells=[]
for ids in tris:
 a,z,d=sorted(ids);A,Z,D=a+n,z+n,d+n
 cells.extend([[a,z,d,D],[a,z,Z,D],[a,A,Z,D]])
cells=np.array(cells)
v=positions[cells].astype(float);mat=np.transpose(v[:,1:]-v[:,:1],(0,2,1));det=np.linalg.det(mat)
flip=det<0; cells[flip,1],cells[flip,2]=cells[flip,2].copy(),cells[flip,1].copy()
v=positions[cells].astype(float);mat=np.transpose(v[:,1:]-v[:,:1],(0,2,1));inv=np.linalg.inv(mat)
skin=[x for x in f['parts'] if x['name']=='cape_cloth' or not args.cloth_region and x['name']!='cape_clasp'];points=np.concatenate([np.array(x['positions']).reshape(-1,3)for x in skin])
# Local coverage certificate independent of the physics engine. Barycentrics
# must put every original render point inside at least one generated cell.
_,near=cKDTree(v.mean(axis=1)).query(points,k=80)
bary=np.einsum('nkij,nkj->nki',inv[near],points[:,None,:]-v[near,0]);bary=np.concatenate([1-bary.sum(axis=2,keepdims=True),bary],axis=2)
scores=bary.min(axis=2);chosen=scores.argmax(axis=1);best=scores[np.arange(len(points)),chosen];selected=near[np.arange(len(points)),chosen]
records=[];indices=[];start=0
for part in skin:
 count=len(part['positions'])//3;records.append({'name':part['name'],'start':start,'count':count});indices.extend(np.array(part['indices'])+start);start+=count
released=catalogue['profiles'][args.attachment_profile]['releasedPins'];pins=[i for i in c['pins']if i not in released]
extra_pins=[entry for entry in extra_pins if all(i in pins for i in entry['parents'])]
pins+= [entry['index']for entry in extra_pins]
out={'schema':'bubu-private-shell-proposal/1','positions':positions.ravel().tolist(),'cells':cells.ravel().tolist(),'skinPositions':points.ravel().tolist(),'skinIndices':list(map(int,indices)),'parts':records,'pins':pins+[i+n for i in pins],'centerPins':pins,'baseCount':n,'sourcePositions':c['positions'],'sourceTriangles':c['indices'],'certificate':{'margin':margin,'particleCount':len(positions),'cellCount':len(cells),'renderCount':len(points),'minimumCellVolume':float(abs(det).min()/6),'minimumEmbeddingBarycentric':float(best.min()),'outsidePoints':int((best< -1e-6).sum()),'worstPoint':int(best.argmin()),'cellSelections':selected.tolist()}}
out['inputHashes']={str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest()for p in [r/'secondary-motion/cloth-probe/cape-coarse.json',r/'secondary-motion/cloth-probe/cape-binding.json',r/'integration/diagnostics/contact-contract-20261019/frozen-cape.json']}
out['attachmentProfile']=args.attachment_profile
out['inputHashes'][str(catalogue_path.relative_to(r))]=hashlib.sha256(catalogue_path.read_bytes()).hexdigest()
if args.refine_boundary:out['schema']='bubu-private-shell-proposal/2';out['extraBoundaryPins']=extra_pins
assert len(positions)<=2048 and len(cells)<=4096 and best.min()>=-1e-6
path=args.output;path.write_text(json.dumps(out,separators=(',',':')))
print({k:v for k,v in out['certificate'].items()if k!='cellSelections'})
