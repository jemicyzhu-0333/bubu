import subprocess,concurrent.futures,sys
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2];workspace=root.parent
rows=[('accessory-expansion','boots',0),('accessory-expansion','boots',90),('accessory-expansion','cape',90),('themed-accessories','plum',180),('themed-accessories','fin',0)]
def run(row):
 folder,k,angle=row;source=workspace/('bubu-'+folder+'-20261018')/'review'/f'{k}-static.json';out=root/folder/'review/weight-v2'/f'before-{k}-{angle}';cmd=['blender','-b','-t','2','--python',str(root/'accessory-expansion/src/render_actual.py'),'--','--input',str(source),'--out',str(out),'--angle',str(angle),'--size','320','--span','3.6','--samples','12'];p=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);assert p.returncode==0,p.stderr
if '--compose-only' not in sys.argv:
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e:list(e.map(run,rows))
sheet=Image.new('RGB',(640,len(rows)*350),(240,240,238));draw=ImageDraw.Draw(sheet)
for r,(folder,k,angle) in enumerate(rows):
 for col,prefix in enumerate(['before-','']):
  p=root/folder/'review/weight-v2'/f'{prefix}{k}-{angle}'/'0000.png';im=Image.open(p).convert('RGBA').resize((320,320));sheet.paste(im,(320*col,350*r+25),im);draw.text((320*col+8,350*r+6),f'{k} / {angle} / '+('before' if col==0 else 'revised actual geometry'),fill=(20,20,20))
sheet.save(root/'accessory-expansion/review/weight-v2/before-after-contact.png')
