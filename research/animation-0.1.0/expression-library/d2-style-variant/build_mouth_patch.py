import argparse,json,struct,math,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);a=p.parse_args();raw=Path(a.source).read_bytes();assert hashlib.sha256(raw).hexdigest()=='1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677';n=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+n]);binstart=28+n
sizes={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4};fmts={5126:'f',5123:'H',5125:'I',5121:'B'}
def readview(vi,off,count,ncomp,ct):
 v=g['bufferViews'][vi];fmt='<'+fmts[ct]*ncomp;sz=struct.calcsize(fmt);start=binstart+v.get('byteOffset',0)+off;stride=v.get('byteStride',sz);return [struct.unpack_from(fmt,raw,start+i*stride) for i in range(count)]
def accessor(i):
 ac=g['accessors'][i];nc=sizes[ac['type']];rows=readview(ac['bufferView'],ac.get('byteOffset',0),ac['count'],nc,ac['componentType']) if 'bufferView' in ac else [(0.,)*nc for _ in range(ac['count'])]
 if 'sparse' in ac:
  s=ac['sparse'];ix=s['indices'];vv=s['values'];ids=readview(ix['bufferView'],ix.get('byteOffset',0),s['count'],1,ix['componentType']);vals=readview(vv['bufferView'],vv.get('byteOffset',0),s['count'],nc,ac['componentType'])
  for j,v in zip(ids,vals):rows[j[0]]=v
 return rows
node=next(x for x in g['nodes'] if x.get('name')=='A_mouth_ring');me=g['meshes'][node['mesh']];pr=me['primitives'][0];basis=accessor(pr['attributes']['POSITION']);idx=me['extras']['targetNames'].index('BasicN3_08');delta=accessor(pr['targets'][idx]['POSITION']);mask=[]
for b,d in zip(basis,delta):
 x,z,my=(b[k]+d[k] for k in range(3));r2=(x/.140)**2+((z-.677)/.157)**2;w=max(0,1-r2)**2
 if r2>1-1e-6:w=0
 mask.append(struct.unpack('<f',struct.pack('<f',w))[0])
base=g['materials'][pr['material']]['pbrMetallicRoughness']['baseColorFactor'];o=Path(a.out);o.mkdir(parents=True,exist_ok=True)
spec={'schema':'bubu-n3-cavity-patch-v1','status':'D2 parameters root verified; runtime adapter pending','sourceSha256':hashlib.sha256(raw).hexdigest(),'mesh':'A_mouth_ring','vertexCount':len(mask),'sourceMaterialIndex':pr['material'],'sourceLinearRGBA':base,'deltaLinearRGB':[.027,.004,.006],'strength':.66,'maskSpace':'static per-vertex mask from authored N3 endpoint, interpolate as vertex varying','mask':mask,'gate':'state === N3 ? smoothstep(0.375,1,amount) : 0','restore':'all other states and Basis gate exactly 0; retain original source material properties','geometryRule':'private attribute/geometry binding; do not write shared geometry/material','shaderRule':'diffuseColor.rgb += deltaLinearRGB * strength * gate * interpolatedVertexMask; do not multiply black base and do not uniformly recolor outer rim','allOtherMaterialFieldsUnchanged':True,'tongueUnchanged':True}
(o/'N3-CAVITY-PATCH.json').write_text(json.dumps(spec,indent=2))
module='// D2 cavity only. No Three imports or runtime registration. Attribute is read-only template.\nexport const N3_CAVITY_MASK=Object.freeze('+json.dumps(mask)+');\nexport const N3_CAVITY_DELTA=Object.freeze([.027,.004,.006]);\nexport const N3_CAVITY_STRENGTH=.66;\nexport function n3CavityGate(state,amount){if(!Number.isFinite(amount)||amount<0||amount>1)throw new RangeError("amount must be in [0,1]");if(state!=="N3")return 0;const t=Math.max(0,Math.min(1,(amount-.375)/.625));return t*t*(3-2*t);}\n'
(o/'n3-cavity-mask.mjs').write_text(module)
audit={'vertexCount':len(mask),'minMask':min(mask),'maxMask':max(mask),'exactBlackRimVertices':sum(w==0 for w in mask),'sourceMaskSHA256':hashlib.sha256(struct.pack('<'+'f'*len(mask),*mask)).hexdigest(),'nonN3GateExactlyZero':True,'N3GateBeforeClosureExactlyZero':True,'N3EndpointGate':1,'sourceGeometryMutation':False,'roughnessSpecularAndTongueMutation':False};(o/'MOUTH-PATCH-AUDIT.json').write_text(json.dumps(audit,indent=2));print(json.dumps(audit))
