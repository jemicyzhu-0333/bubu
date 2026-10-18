from PIL import Image,ImageDraw
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'renders'
for title,ids in [('current-work-contact',['keyboard','laptop']),('current-music-contact',['microphone','drum'])]:
 o=Image.new('RGB',(1536,820),'#f4f2ee');d=ImageDraw.Draw(o)
 for j,(i,v) in enumerate((i,v) for i in ids for v in ['front','side','quarter','back']):
  f=p/f'accepted-candidate-{i}-{v}'/'0000.png';im=Image.open(f).convert('RGBA');o.paste(im,(j%4*384,j//4*410),im);d.text((j%4*384+10,j//4*410+385),i+' '+v,fill='black')
 o.save(p/(title+'.png'))
a=Image.open(p/'current-work-contact.png');b=Image.open(p/'current-music-contact.png');out=Image.new('RGB',(1536,1640),'#f4f2ee');out.paste(a,(0,0));out.paste(b,(0,820));out.save(p/'all-four-static-contact.png')
standalone=Image.new('RGB',(1536,1640),'white');d=ImageDraw.Draw(standalone)
for j,(i,v) in enumerate((i,v) for i in ['keyboard','laptop','microphone','drum'] for v in ['front','side','quarter','back']):
 im=Image.open(p/f'{i}-{v}.png').convert('RGB');standalone.paste(im,(j%4*384,j//4*410));d.text((j%4*384+10,j//4*410+385),i+' '+v,fill='black')
standalone.save(p/'all-four-model-contact.png')
