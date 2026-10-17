from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import argparse
p=argparse.ArgumentParser();p.add_argument('--review',required=True);a=p.parse_args();r=Path(a.review);s=['R0','D1','A7','D4','01','N2','N3','T05','07','P2','08','A4','04','A8','S2','S3','T5','S5'];im=Image.new('RGB',(900,480),'#f1efec');d=ImageDraw.Draw(im);f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18);d.text((12,10),'Actual full18 D2 body-color GLB / all source mouth materials unchanged',fill='#333333',font=f)
for i,st in enumerate(s):
 x=(i%6)*150;y=45+(i//6)*140;d.text((x+10,y),st,fill='#333333',font=f);v=Image.open(r/f'{st}-front.png');im.paste(v,(x+4,y+20),v)
im.save(r/'all18-body-variant.png')
