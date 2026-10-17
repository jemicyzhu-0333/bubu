import json,numpy as np,copy
from pathlib import Path
P=Path(__file__).resolve().parent;L=P;G=L/'generated'
tns={'__file__':str(P/'trajectory-build.py')};exec((P/'trajectory-build.py').read_text().split('rows=[]')[0],tns)
ens={'__file__':str(P/'build-entry.py')};exec((P/'build-entry.py').read_text().split('for i,u in enumerate')[0],ens)
base=tns['base'];body=next(m for m in base['meshes'] if m['name']=='A_mochi_skin');manifests=[]
for file in sorted(G.glob('*.json')):
 if file.stem.endswith('-geometry') or file.stem.startswith('reference-'):continue
 source=json.loads(file.read_text());frames=[]
 for i,f in enumerate(source['frames']):
  cue=f['cue'];q,cup,par,center,rot=tns['sample'](cue['lift']);q=ens['entry'](cue['handEntry']) if cue['handEntry']<1 else q
  bodyfile=G/f'{file.stem}-{i:03}-body.bin';q.astype('<f4').tofile(bodyfile);bm=copy.deepcopy(body) if i==0 else {'name':'A_mochi_skin'};bm.pop('positions',None);bm['positionsFile']=str(bodyfile.resolve());meshes=[bm]+f['meshes']
  for m in cup['meshes']:
   pos=np.array(m['positions']).reshape(-1,3);pos=center+(pos-center)*cue['cupScale'];cf=G/f'{file.stem}-{i:03}-{m["name"]}.bin';pos.astype('<f4').tofile(cf);m.pop('positions');m['positionsFile']=str(cf.resolve());m['opacity']=cue['cupOpacity'];meshes.append(m)
  if i>0:
   for mm in meshes:
    for kk in ['indices','colors','diffuseColors','faceWeights']:mm.pop(kk,None)
  frames.append({'time':f['time'],'label':f['label'],'meshes':meshes,'cue':cue,'faceState':f['faceState'],'cupCenter':center.tolist(),'cupRotation':rot.tolist(),'cupParameters':par})
 out={'sourceGLB':tns['data']['sourceGLB'],'cancelAt':source['cancelAt'],'scope':'offline rest-to-rest prototype; actual owner08 enter/exit, scale/fade cup; no host registration','frames':frames};target=G/(file.stem+'-geometry.json');target.write_text(json.dumps(out));manifests.append(str(target));print(file.stem,len(frames),flush=True)
(L/'geometry-manifests.json').write_text(json.dumps(manifests,indent=2))
