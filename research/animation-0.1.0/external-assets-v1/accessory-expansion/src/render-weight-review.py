"""Current adapter geometry only; fixed multiview and recorded input keyframes."""
import json,sys,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2];cache=root/'.cache/weight'
jobs=[]
for folder,group,kinds in [('accessory-expansion','accessory',['halo','boots','cape']),('themed-accessories','themed-accessories',['cap','fin','wings','plum'])]:
 out=root/folder/'review/weight-v2';out.mkdir(exist_ok=True,parents=True)
 for k in kinds:
  for angle in [0,45,90,180]:
   jobs.append((folder,k,angle,cache/group/'review'/f'{k}-static.json',out/f'{k}-{angle}'))
 for k in (['cape'] if group=='accessory' else ['wings','plum']):
  source=json.loads((cache/group/'review/trajectory-keyframes.json').read_text());frames=[f for f in source['frames'] if f['label'].endswith('-'+k) and ('drag-90-' in f['label'] or 'longpress-990-' in f['label'])]
  for f in frames:
   name=f['label'].split('-')[0]
   old=Path('/workspace/scratch/10657b778e8b/bubu-recovery-20261017/runtime/evidence/actual-pointer')/name/'manifest.json'
   d=json.loads(old.read_text());nearest=min(d['frames'],key=lambda v:abs(v['time']-f['time']));assert abs(nearest['time']-f['time'])<1e-8
   faces=[{**d['topology'][m['name']],**m} for m in nearest['meshes'] if m['name'].startswith('A_') and m['name']!='A_mochi_skin']
   f['meshes']=[m for m in f['meshes'] if not m['name'].startswith('A_')]+faces
  # These are the actual replayed actor/adapter vertices. No render-time pose authoring.
  item=cache/group/'review'/f'{k}-motion-weight.json';item.write_text(json.dumps({**source,'frames':frames}))
  jobs.append((folder,k+'-motion',90,item,out/f'{k}-motion-90'))
for folder,k,angle,source,out in jobs:
 if (out/'0000.png').exists() and '--force' not in sys.argv:continue
 cmd=['blender','-b','-t','2','--python',str(root/folder/'src/render_actual.py'),'--','--input',str(source),'--out',str(out),'--angle',str(angle),'--size','320','--span','3.6','--samples','8']
 result=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);assert result.returncode==0,result.stderr
 print(folder,k,angle,flush=True)
for folder,group,kinds in [('accessory-expansion','accessory',['halo','boots','cape']),('themed-accessories','themed-accessories',['cap','fin','wings','plum'])]:
 out=root/folder/'review/weight-v2';sheet=Image.new('RGB',(1280,len(kinds)*350),(240,240,238));draw=ImageDraw.Draw(sheet)
 for row,k in enumerate(kinds):
  for col,angle in enumerate([0,45,90,180]):
   im=Image.open(out/f'{k}-{angle}'/'0000.png').convert('RGBA');sheet.paste(im,(col*320,row*350+25),im);draw.text((col*320+8,row*350+6),f'{k} | {angle} degrees | weighted v2 CPU',fill=(20,20,20))
 sheet.save(out/'multiview.png')
