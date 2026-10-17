from PIL import Image,ImageDraw
from pathlib import Path
import json,subprocess
P=Path(__file__).resolve().parents[1];records=json.loads((P/'evidence/trajectory.json').read_text());out=P/'evidence/annotated';out.mkdir(exist_ok=True)
for i,r in enumerate(records):
 im=Image.new('RGBA',(384,384),'#eeeae6');im.alpha_composite(Image.open(P/f'evidence/frames/{i:04d}.png').convert('RGBA'));d=ImageDraw.Draw(im);gy=192-(.006-1.5)*384/5
 for x in range(0,384,12):d.line((x,gy,x+6,gy),fill='#b4aaa2')
 d.text((8,8),f'{r["time"]:.2f}s {r["drag"]["mode"]} / {r["face"].get("path") or "Basis"}',fill='#443c36');d.text((8,365),'Actual D2 CPU replay | 30fps | 10deg',fill='#665b52');im.convert('RGB').save(out/f'{i:04d}.png')
subprocess.run(['ffmpeg','-y','-framerate','30','-i',str(out/'%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',str(P/'evidence/landing-r5-normal-speed.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
indices=[165,180,186,190,194,198,204,222];sheet=Image.new('RGB',(384*4,408*2),'#eeeae6')
for n,i in enumerate(indices):sheet.paste(Image.open(out/f'{i:04d}.png'),((n%4)*384,(n//4)*408))
sheet.save(P/'evidence/landing-keyframes.png')
