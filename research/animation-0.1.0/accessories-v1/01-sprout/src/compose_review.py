from pathlib import Path
from PIL import Image,ImageDraw
P=Path(__file__).resolve().parents[1];r=P/'review'
def sheet(names,cols,out):
 im=Image.new('RGB',(cols*384,((len(names)+cols-1)//cols)*410),'#f3eee7');d=ImageDraw.Draw(im)
 for i,n in enumerate(names):
  a=Image.open(r/(n+'.png'));x=i%cols*384;y=i//cols*410;im.paste(a,(x,y),a);d.text((x+12,y+388),n,fill='#333333')
 im.save(r/out)
sheet(['worn-'+v for v in ['front','quarter','side','back']]+['isolated-'+v for v in ['front','quarter','side','back']],4,'sprout-contact-sheet.png')
sheet(['turn-%03d'%a for a in range(0,360,30)],4,'sprout-360-sheet.png')
sheet(['motion-%02d'%i for i in range(8)],4,'sprout-motion-sheet.png')

sheet(['worn-'+v for v in ['front','quarter','quarter-opposite','side']],4,'sprout-revised-angle-sheet.png')
