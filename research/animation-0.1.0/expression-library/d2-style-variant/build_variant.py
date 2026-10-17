"""Exact byte-range patch of approved full18 body COLOR_0; no geometry/material/morph edits."""
import argparse,struct,json,hashlib,gzip,math
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);a=p.parse_args();src=Path(a.source);out=Path(a.out);out.mkdir(parents=True,exist_ok=True);raw=src.read_bytes();raw=gzip.decompress(raw) if src.suffix=='.gz' else raw
source_hash='1100131118479ecb266c029082d311f18e5b2564ad0a1077182ac934e769d677';assert hashlib.sha256(raw).hexdigest()==source_hash,'Unexpected source full18 asset'
assert raw[:4]==b'glTF';jlen=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+jlen]);binstart=20+jlen+8
node=next(n for n in g['nodes'] if n.get('name')=='A_mochi_skin');prim=g['meshes'][node['mesh']]['primitives'][0]
def data_offset(ai):
 ac=g['accessors'][ai];assert ac['componentType']==5126 and ac['type']=='VEC3' and 'sparse' not in ac;bv=g['bufferViews'][ac['bufferView']];assert bv.get('byteStride',12)==12;return binstart+bv.get('byteOffset',0)+ac.get('byteOffset',0),ac['count']
po,n=data_offset(prim['attributes']['POSITION']);co,nc=data_offset(prim['attributes']['COLOR_0']);assert nc==n
result=bytearray(raw);changed=[];outside=[];weights=[];target=(.86,.090*.218/.24,.125*.230/.252)
for i in range(n):
 x,z,minus_y=struct.unpack_from('<3f',raw,po+12*i);old=struct.unpack_from('<3f',raw,co+12*i);r2=((abs(x)-.61)/.27)**2+((z-.80)/.17)**2;field=max(0,1-r2)**2;front=max(0,min(1,(minus_y-.18)/.4));front=front*front*(3-2*front);w=.56*field*front;weights.append(w)
 if not w:outside.append(i);continue
 struct.pack_into('<3f',result,co+12*i,*(old[k]+(target[k]-old[k])*w for k in range(3)))
 if result[co+12*i:co+12*i+12]!=raw[co+12*i:co+12*i+12]:changed.append(i)
assert result[:co]==raw[:co] and result[co+12*n:]==raw[co+12*n:]
assert all(result[co+i*12:co+i*12+12]==raw[co+i*12:co+i*12+12] for i in outside)
name='bubu-full18-d2-static-blush.glb';(out/name).write_bytes(result);compressed=gzip.compress(bytes(result),compresslevel=9,mtime=0);(out/(name+'.gz')).write_bytes(compressed);h=hashlib.sha256(result).hexdigest()
audit={'variantId':'full18-d2-static-blush-v1','status':'candidate asset; source/production registration unchanged','sourceSHA256':source_hash,'variantSHA256':h,'gzipSHA256':hashlib.sha256(compressed).hexdigest(),'bytes':len(result),'gzipBytes':len(compressed),'changedAccessor':prim['attributes']['COLOR_0'],'changedByteRange':[co,co+12*n],'allBytesOutsideBodyColorAccessorExact':True,'allJSONMaterialsNodesRigMorphMetadataExact':True,'allOtherAccessorsExact':True,'accessorsCount':len(g['accessors']),'meshCount':len(g['meshes']),'bodyVertexCount':n,'changedBodyVertices':len(changed),'outsideSupportColorsExact':True,'peakMix':max(weights),'canonicalTintTarget':target,'lookTintTarget':[.95,.090,.125],'fixedCheekMix':.56,'mouthAndTongueUnchanged':True,'semanticStates':['R0','D1','A7','D4','01','N2','N3','T05','07','P2','08','A4','04','A8','S2','S3','T5','S5'],'scope':'Static local cheek tint only; optional N3 cavity patch is separate and not baked into shared mouth'}
(out/'VARIANT-AUDIT.json').write_text(json.dumps(audit,indent=2));print(json.dumps(audit,indent=2))
