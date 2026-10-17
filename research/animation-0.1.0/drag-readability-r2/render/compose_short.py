from pathlib import Path
from PIL import Image,ImageDraw
import subprocess,json
P=Path(__file__).resolve().parents[1];out=P/'evidence/comparison-frames';out.mkdir(exist_ok=True)
for i in range(40):
 frame=Image.new('RGB',(552,600),'#eeeae6');draw=ImageDraw.Draw(frame)
 for n,(start,label) in enumerate([(0,'10deg | v1 weaker hover'),(40,'10deg | r2 opposed + hold'),(80,'52deg | v1 weaker hover'),(120,'52deg | r2 opposed + hold')]):
  im=Image.open(P/f'evidence/short-render/{start+i:04d}.png').resize((276,276));x=(n%2)*276;y=(n//2)*300;frame.paste(im,(x,y+24),im);draw.text((x+8,y+7),label,fill='#443c36');draw.text((x+8,y+280),f'{i/25:.2f}s | body locked | fixed 01 face',fill='#665b52')
 frame.save(out/f'{i:04d}.png')
subprocess.run(['ffmpeg','-y','-framerate','25','-i',str(out/'%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',str(P/'evidence/r2-native-scale-1p6s.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print('Private 1.6-second 25fps comparison, no root/body sway.')
