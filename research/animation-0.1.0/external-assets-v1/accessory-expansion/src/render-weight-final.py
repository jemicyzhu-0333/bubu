import json,subprocess,concurrent.futures,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2];cache=root/'.cache/weight';jobs=[]
for folder,group,kinds in [('accessory-expansion','accessory',['halo','boots','cape']),('themed-accessories','themed-accessories',['cap','fin','wings','plum'])]:
 out=root/folder/'review/weight-v2'
 for k in kinds:
  for angle in [0,45,90,180]:jobs.append((folder,cache/group/'review'/f'{k}-static.json',out/f'{k}-{angle}',angle,0))
 for k in (['cape'] if group=='accessory' else ['fin','plum']):
  d=json.loads((cache/group/'review'/f'{k}-static.json').read_text());tail=json.loads((root/'body-tail/tail-mesh.json').read_text());m=np.array(d['sourceToWorld']).reshape(4,4).T;p=np.array(tail['positions']).reshape(-1,3);tail['positions']=(p@m[:3,:3].T+m[:3,3]).ravel().tolist();d['frames'][0]['meshes'].append(tail)
  combined=cache/group/'review'/f'{k}-with-tail.json';combined.write_text(json.dumps(d))
  for angle in [45,90,180]:jobs.append((folder,combined,out/f'{k}-tail-{angle}',angle,0))
jobs.append(('accessory-expansion',cache/'accessory/review/boots-static.json',root/'accessory-expansion/review/weight-v2/boots-bottom',0,-35))
def run(job):
 folder,source,out,angle,elevation=job
 script=root/'accessory-expansion/src/render_actual.py'
 cmd=['blender','-b','-t','2','--python',str(script),'--','--input',str(source),'--out',str(out),'--angle',str(angle),'--elevation',str(elevation),'--size','320','--span','3.6','--samples','12']
 p=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);assert p.returncode==0,p.stderr
 print(out.name,flush=True)
if '--fin-only' in sys.argv:jobs=[j for j in jobs if j[1].name.startswith('fin-')]
if '--plum-only' in sys.argv:jobs=[j for j in jobs if j[1].name.startswith('plum-')]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:list(executor.map(run,jobs))
for folder,group,kinds in [('accessory-expansion','accessory',['halo','boots','cape']),('themed-accessories','themed-accessories',['cap','fin','wings','plum'])]:
 out=root/folder/'review/weight-v2';sheet=Image.new('RGB',(1280,len(kinds)*350),(240,240,238));draw=ImageDraw.Draw(sheet)
 for row,k in enumerate(kinds):
  for col,angle in enumerate([0,45,90,180]):
   im=Image.open(out/f'{k}-{angle}'/'0000.png').convert('RGBA').resize((320,320));sheet.paste(im,(col*320,row*350+25),im);draw.text((col*320+8,row*350+6),f'{k} | {angle} degrees | actual weighted v2',fill=(20,20,20))
 sheet.save(out/'multiview.png')
