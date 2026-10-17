from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
P=Path(__file__).resolve().parents[1]; data=json.loads((P/'evidence/keyframes.json').read_text());font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
sheet=Image.new('RGB',(1152,1278),(246,245,242));draw=ImageDraw.Draw(sheet)
for i,f in enumerate(data['frames']):
 x=(i%3)*384;y=(i//3)*426
 im=Image.open(P/f'preview/keyframes-color/{i:04}.png').convert('RGBA').resize((384,384),Image.Resampling.LANCZOS); sheet.paste(im,(x,y+32),im)
 draw.text((x+12,y+5),f"{f['time']:.2f}s  {f['label']}",font=font,fill=(25,25,30))
 ground=y+32+(1.5-.006)/3.15*384+192
 draw.line((x+40,ground,x+345,ground),fill=(157,172,174),width=1)
 if f.get('contact'):
  px=x+192+f['contact'][0]/3.15*384;py=y+32+192+(1.5-f['contact'][1])/3.15*384
  draw.ellipse((px-4,py-4,px+4,py+4),outline=(170,105,0),width=2)
 draw.text((x+12,y+408),f"Actual owner: {f['face']['path'] or 'Basis'}  {f['face']['amount']:.2f}",font=small,fill=(65,65,72))
sheet.save(P/'preview/petting-key-stages.png')
