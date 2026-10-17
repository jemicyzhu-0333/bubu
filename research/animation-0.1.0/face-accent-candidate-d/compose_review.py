from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import argparse
a=argparse.ArgumentParser();a.add_argument('--input',required=True);a.add_argument('--out',required=True);args=a.parse_args()
P=Path(args.input);F='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
out=Image.new('RGB',(852,830),'#f1efec');d=ImageDraw.Draw(out);d.text((18,15),'BUBU / cheek + mouth detail study',fill='#333333',font=ImageFont.truetype(F,25));d.text((18,49),'Candidate only / same body and facial geometry',fill='#555555',font=ImageFont.truetype(F,17))
for x,title in [(20,'Original'),(444,'Candidate D')]:d.text((x,85),title,fill='#333333',font=ImageFont.truetype(F,22))
for i,st in enumerate(['P2','N3']):
 y=124+i*350;d.text((18,y),st,fill='#333333',font=ImageFont.truetype(F,17))
 for j,path in enumerate([P/f'{st}-original-front.png',P/f'{st}-local-soft-front.png']):
  im=Image.open(path);out.paste(im,(10+j*424,y+10),im)
d.text((18,812),'P2: local soft blush. N3: same blush + warmer cavity; tongue outline unchanged.',fill='#555555',font=ImageFont.truetype(F,14));out.save(Path(args.out))
