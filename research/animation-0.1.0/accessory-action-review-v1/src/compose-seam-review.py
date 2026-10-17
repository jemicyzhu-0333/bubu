from pathlib import Path
from PIL import Image,ImageDraw
P=Path(__file__).resolve().parents[1]/'work'
for label,ids in [('pickup',list(range(10))),('landing',list(range(60,69)))]:
 cols=5 if label=='pickup' else 3;w,h=400,245;sheet=Image.new('RGB',(cols*w,((len(ids)+cols-1)//cols)*h),(238,238,238));d=ImageDraw.Draw(sheet)
 for j,i in enumerate(ids):
  a=Image.open(P/f'seam-sequence/{i:04d}-waist-close.png').convert('RGBA').crop((120,180,440,355)).resize((400,219));back=Image.new('RGBA',a.size,(238,238,238,255));back.alpha_composite(a);x=j%cols*w;y=j//cols*h;sheet.paste(back.convert('RGB'),(x,y+26));d.text((x+8,y+7),f'{label}  t={i/10:.1f}s',fill=(20,20,20))
 sheet.save(P/f'seam-{label}-contact.png')
