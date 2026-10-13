import os
from PIL import Image,ImageDraw
from pathlib import Path
import json,math
O=Path(__file__).resolve().parent;P=Path(os.environ['DANGO_CANONICAL_PACKAGE']);d=json.load(open(P/'sources/canonical/render-reference.json'))['views']['three-quarter-left'];m=json.load(open(P/'limbs.json'));a=json.load(open(O/'gait-source.json'));fs={x['id']:x for x in a['frames']};C=(108,86);origin=(16,10)
def layer(rec,dy):
 src=Image.open(P/rec['src']).convert('RGBA');r=rec['rect'];out=Image.new('RGBA',C)
 for y in range(C[1]):
  for x in range(C[0]):
   u=math.floor((66-(x-origin[0]+.5)-r[0])*src.width/r[2]);v=math.floor((y-origin[1]+.5-dy-r[1])*src.height/r[3])
   if 0<=u<src.width and 0<=v<src.height:out.putpixel((x,y),src.getpixel((u,v)))
 return out
def paw(side):
 f=next(x for x in m['paws']['rest']['views']['three-quarter-left']if x['semantic']['nominalAngle']==180);im=Image.open(P/f['src']).convert('RGBA');root=f['root'];
 if side=='far':im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);root=[im.width-root[0],root[1]]
 return im,root
phases=[('near-support-far-swing','near-support','far-reach',0,0,4),('far-support-near-swing','near-reach','far-support',0,4,0),('flight-near-forward','near-recovery','far-recovery',-2,3,4),('flight-far-forward','near-trailing','far-forward',-2,4,3)]
sheet=Image.new('RGB',(4*280,390),'#f1f3ee');dr=ImageDraw.Draw(sheet);plans=[]
for i,(name,n,f,dy,nclear,fclear) in enumerate(phases):
 canvas=Image.new('RGBA',C);feet=[]
 for role,id,hipx,clearance in [('near',n,21.5,nclear),('far',f,47.5,fclear)]:
  r=fs[id];im=Image.open(O/r['src']);root=r['root'];sole=r['sole'];world=[hipx,64.5-clearance-(sole[1]-root[1])];pos=[round(world[k]-root[k]+origin[k])for k in [0,1]];feet.append((role,im,pos,r,world,clearance))
 for role,im,pos,r,world,clearance in feet:
  if clearance==0:canvas.alpha_composite(im,pos)
 im,root=paw('far');canvas.alpha_composite(im,(round(61.5-root[0]+origin[0]),round(40.5+dy-root[1]+origin[1])))
 canvas.alpha_composite(layer(d['body'],dy))
 for rec in d['parts'].values():canvas.alpha_composite(layer(rec,dy))
 for rec in d['face']['eyes']['neutral']:canvas.alpha_composite(layer(rec,dy))
 canvas.alpha_composite(layer(d['face']['mouth']['neutral'],dy))
 im,root=paw('near');canvas.alpha_composite(im,(round(3.5-root[0]+origin[0]),round(39.5+dy-root[1]+origin[1])))
 for role,im,pos,r,world,clearance in feet:
  if clearance>0:canvas.alpha_composite(im,pos)
 canvas.save(O/(name+'-native.png'));canvas.resize((216,172),Image.Resampling.NEAREST).save(O/(name+'-2x.png'))
 x=i*280;dr.text((x+4,4),name,fill='#1a1b26');sheet.paste(canvas,(x+6,25),canvas);big=canvas.resize((216,172),Image.Resampling.NEAREST);sheet.paste(big,(x+6,122),big)
 # Bottom visual uses ground guide external to artwork.
 dr.line((x+10,122+(64.5+origin[1])*2,x+210,122+(64.5+origin[1])*2),fill='#89958c')
 dr.text((x+6,315),f'near clearance {nclear}; far {fclear}',fill='#1a1b26')
 plans.append({'name':name,'bodyTranslationY':dy,'groundY':64.5,'feet':[{'role':role,'frame':r['id'],'rootWorld':world,'rootDeltaFromHip':[world[0]-(21.178747 if role=='near'else 47.801009),world[1]-(56.123077+dy)],'soleWorld':[world[k]+r['sole'][k]-r['root'][k]for k in[0,1]],'support':clearance==0,'clearance':clearance,'layer':'back'if clearance==0 else'front'}for role,im,pos,r,world,clearance in feet]})
sheet.save(O/'canonical-phase-set-review.png');(O/'phase-set.json').write_text(json.dumps({'status':'static source-foot/canonical-body assembly, not runtime or complete gait','phases':plans},indent=2)+'\n')
