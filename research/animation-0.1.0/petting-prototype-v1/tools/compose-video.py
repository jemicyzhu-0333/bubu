from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,time,subprocess
P=Path(__file__).resolve().parents[1]; V=P/'preview/video'
while not (V/'manifest.json').exists(): time.sleep(2)
a=json.loads((V/'manifest.json').read_text());font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11);counts={}
for chunk in a['chunks']:
 folder=V/Path(chunk['name']).stem
 while not (folder/'render-manifest.json').exists(): time.sleep(3)
 segment=chunk['segment'];target=V/segment;target.mkdir(exist_ok=True)
 for i,frame in enumerate(chunk['frames']):
  im=Image.open(folder/f'{i:04}.png').convert('RGBA');canvas=Image.new('RGB',(384,320),(246,245,242));canvas.paste(im.crop((0,112,384,384)),(0,28),im.crop((0,112,384,384)));d=ImageDraw.Draw(canvas)
  d.text((10,7),f"{frame['time']:05.2f}s  |  {frame['phase']}  |  1x speed",font=font,fill=(30,30,35))
  y=28+192+(1.5-.006)/3.15*384-112;d.line((30,y,355,y),fill=(160,173,173),width=1)
  c=frame.get('contact')
  if c:
   x=192+c[0]/3.15*384;y=28+192+(1.5-c[1])/3.15*384-112;d.ellipse((x-4,y-4,x+4,y+4),outline=(169,105,0),width=2)
  d.text((10,304),f"{frame['face'] or 'Basis'} {frame['amount']:.2f}  |  actual surface marker",font=small,fill=(65,65,70))
  n=counts.get(segment,0);canvas.save(target/f'{n:05}.png');counts[segment]=n+1
for segment,count in counts.items():
 subprocess.run(['ffmpeg','-y','-framerate',str(a['fps']),'-i',str(V/segment/'%05d.png'),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(P/'preview'/f'petting-{segment}.mp4')],check=True)
print(json.dumps({'fps':a['fps'],'speed':1,'segments':counts,'fixedCrop':[0,112,384,384]}))
