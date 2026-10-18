import json,subprocess,concurrent.futures
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2];cache=root/'.cache/weight';jobs=[]
for folder,group,kinds in [('accessory-expansion','accessory',['cape']),('themed-accessories','themed-accessories',['wings','plum'])]:
 out=root/folder/'review/weight-v2';d=json.loads((cache/group/'review/trajectory-keyframes.json').read_text())
 for k in kinds:
  frames=[f for f in d['frames'] if f['label'].endswith('-'+k) and ('drag-90-' in f['label'] or 'longpress-990-' in f['label'])];assert len(frames)==2
  for f in frames:
   scenario=f['label'].split('-')[0];original=Path('/workspace/scratch/10657b778e8b/bubu-recovery-20261017/runtime/evidence/actual-pointer')/scenario/'manifest.json';ref=json.loads(original.read_text());match=min(ref['frames'],key=lambda t:abs(t['time']-f['time']));assert abs(match['time']-f['time'])<1e-8
   faces=[{**ref['topology'][m['name']],**m} for m in match['meshes'] if m['name'].startswith('A_') and m['name']!='A_mochi_skin'];f['meshes']=[m for m in f['meshes'] if not m['name'].startswith('A_')]+faces
  p=cache/group/'review'/f'{k}-motion-weight.json';p.write_text(json.dumps({'sourceGLB':d['sourceGLB'],'frames':frames}));jobs.append((p,out/f'{k}-motion-90',90))
 tea=json.loads((cache/group/'review/tea-combined.json').read_text());frames=[f for f in tea['frames'] if f['time'] in [1.5,3.4,6.2]];assert frames
 for f in frames:
  if group=='themed-accessories':f['meshes']=[m for m in f['meshes'] if not m['name'].startswith(('cap_','fin_','wings_'))]
 p=cache/group/'review/tea-weight-selected.json';p.write_text(json.dumps({'sourceGLB':tea['sourceGLB'],'frames':frames}));jobs.append((p,out/'tea-45',45))
def run(j):
 p,out,angle=j;c=['blender','-b','-t','2','--python',str(root/'accessory-expansion/src/render_actual.py'),'--','--input',str(p),'--out',str(out),'--angle',str(angle),'--size','320','--span','4','--samples','12'];r=subprocess.run(c,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);assert r.returncode==0,r.stderr;print(out,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e:list(e.map(run,jobs))
for folder in ['accessory-expansion','themed-accessories']:
 out=root/folder/'review/weight-v2';imgs=[p for p in sorted(out.glob('*-motion-90/*.png'))]+sorted((out/'tea-45').glob('*.png'));sheet=Image.new('RGB',(320*len(imgs),350),(240,240,238));draw=ImageDraw.Draw(sheet)
 for i,p in enumerate(imgs):
  im=Image.open(p).convert('RGBA');sheet.paste(im,(i*320,25),im);draw.text((i*320+7,6),p.parent.name+' / '+p.stem,fill=(20,20,20))
 sheet.save(out/'interaction-sheet.png')
