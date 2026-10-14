import os
from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib
O=Path(__file__).resolve().parent;G=O.parent;P=Path(os.environ['DANGO_CANONICAL_PACKAGE'])
# Reuse only the existing renderer definitions, never its output-writing statements.
ns={'__file__':str(G/'render_phase_set.py')};exec((G/'render_phase_set.py').read_text().split('phases=')[0],ns)
layer,paw,d=ns['layer'],ns['paw'],ns['d'];origin=ns['origin'];C=(174,86)
m=json.load(open(P/'limbs.json'));src=json.load(open(G/'gait-source.json'));fs={f['id']:f for f in src['frames']};samples=json.load(open(O/'samples.json'))
body=Image.new('RGBA',(108,86));im,root=paw('far');body.alpha_composite(im,(round(61.5-root[0]+16),round(40.5-root[1]+10)));body.alpha_composite(layer(d['body'],0))
for rec in d['parts'].values():body.alpha_composite(layer(rec,0))
for rec in d['face']['eyes']['neutral']:body.alpha_composite(layer(rec,0))
body.alpha_composite(layer(d['face']['mouth']['neutral'],0));im,root=paw('near');body.alpha_composite(im,(round(3.5-root[0]+16),round(39.5-root[1]+10)))
def compose(s):
 out=Image.new('RGBA',C);front=[]
 for f in s['feet']:
  r=fs[f['frame']];im=Image.open(G/r['src']).convert('RGBA');pos=tuple(round(f['rootWorld'][k]-r['root'][k]+origin[k]) for k in (0,1));out.alpha_composite(im,pos)
  if not f['support']:
   distal=im.copy();pts=[(x+.5,y+.5)for y in range(im.height)for x in range(im.width)if im.getpixel((x,y))[3]];axis=[sum(p[k]for p in pts)/len(pts)-r['root'][k]for k in (0,1)]
   for y in range(im.height):
    for x in range(im.width):
     if sum((v-r['root'][k])*axis[k]for k,v in enumerate((x+.5,y+.5)))<=0:distal.putpixel((x,y),(0,0,0,0))
   front.append((distal,pos))
 out.alpha_composite(body,(round(s['bodyWorldX']),0))
 for im,pos in front:out.alpha_composite(im,pos)
 return out
bgs=['#f1f3ee','#202331'];inks=['#1a1b26','#f1f3ee']
def tile(im,bg,scale,caption):
 out=Image.new('RGB',(round(C[0]*scale),round(C[1]*scale)+34),bg);dr=ImageDraw.Draw(out);ink=inks[bgs.index(bg)];dr.text((4,3),caption,fill=ink);yy=round((64.5+10)*scale)+28;dr.line((0,yy,out.width,yy),fill='#748176',width=1)
 for x in range(0,C[0],10):dr.line((round(x*scale),yy,round(x*scale),yy+4),fill='#748176')
 out.paste(im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST),(0,28),im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST));return out
for mode,ss in samples.items():
 imgs=[compose(s)for s in ss];panels=[]
 for i,(s,im)in enumerate(zip(ss,imgs)):
  panel=Image.new('RGB',(783,584),'#f1f3ee');ImageDraw.Draw(panel).rectangle((0,292,783,584),fill='#202331')
  for j,bg in enumerate(bgs):
   for k,scale in enumerate([1.5,3]):
    t=tile(im,bg,scale,f'{mode} q={s["q"]:.3f} support={s["supportCount"]} flight={s["flight"]}');panel.paste(t,(0 if k==0 else 261,j*292))
  panels.append(panel)
 panels[0].save(O/f'{mode}-replay-light-dark-1x-2x.gif',save_all=True,append_images=panels[1:],duration=33,loop=0,optimize=False)
 # Filmstrip actual replay frames, same 99 CSS design width as the 1x replay.
 inds=[0,15,23,27,30,45,53,57];sheet=Image.new('RGB',(4*261,4*163),'#f1f3ee')
 for row,bg in enumerate(bgs):
  for j,i in enumerate(inds):sheet.paste(tile(imgs[i],bg,1.5,f'{mode} q={ss[i]["q"]:.3f} S={ss[i]["supportCount"]} F={ss[i]["flight"]}'),(j%4*261,(row*2+j//4)*163))
 sheet.save(O/f'{mode}-filmstrip.png');panels[27].save(O/f'{mode}-sample-light-dark-1x-2x.png')
# Static old/new comparison: identical body, hip x, sole ground and rendering; no hidden resizing.
old=m['feet']['stand']['views']['three-quarter-left'][0]
def stand(use_new):
 out=Image.new('RGBA',C)
 for role,hipx in [('near',21.178747),('far',47.801009)]:
  if use_new:r=fs[role+'-support'];im=Image.open(G/r['src']);root=r['root'];sole=r['sole']
  else:
   r=old;im=Image.open(P/r['src']);root=r['root'];sole=r['sole']
   # Right-facing canonical comparison reflects left-facing old stand art.
   im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);root=[im.width-root[0],root[1]];sole=[im.width-sole[0],sole[1]]
  world=[math.floor(hipx)+.5,64.5-(sole[1]-root[1])];pos=tuple(round(world[k]-root[k]+origin[k])for k in (0,1));out.alpha_composite(im,pos)
 out.alpha_composite(body);return out
comparison=Image.new('RGB',(1044,584))
for j,bg in enumerate(bgs):
 for i,use_new in enumerate([False,True]):
  for k,scale in enumerate([1.5,3]):
   im=stand(use_new);t=tile(im,bg,scale,('NEW support'if use_new else'OLD approved stand')+f' / {99 if k==0 else 198} CSS design width');
   # 1x above 2x at equal scale in each column.
   if k==0:comparison.paste(t,(i*522,j*292))
   else:
    # Separate full size sheets avoid cramped layout.
    pass
for scale,label in [(1.5,'1x'),(3,'2x')]:
 ts=[tile(stand(n),bg,scale,('NEW support'if n else'OLD approved stand')+f' / {99 if scale==1.5 else 198} CSS design width')for bg in bgs for n in [False,True]];w,h=ts[0].size;sheet=Image.new('RGB',(w*2,h*2));
 for i,t in enumerate(ts):sheet.paste(t,((i%2)*w,(i//2)*h))
 sheet.save(O/f'old-new-same-scale-{label}.png')
# Preserve source pixels in an annotated mask overlay at source scale.
master=Image.open(G/'masters/run-contact-study-v3.png').convert('RGBA');overlay=master.copy();dr=ImageDraw.Draw(overlay)
for r in src['frames']:
 dr.line([tuple(x)for x in r['polygon']]+[tuple(r['polygon'][0])],fill='#00ffff',width=2);dr.text((r['crop'][0],r['crop'][1]-15),r['id'],fill='#00ffff')
overlay.save(O/'source-mask-overlay.png')
print('Rendered exact helper replay, static equal-scale controls, and source mask overlay.')

for mode in ['run','walk']:
 inds=([23,24,25,26,53,54,55,56]if mode=='run'else[32,33,34,35,62,63,64,65]);tiles=[tile(compose(samples[mode][i]),bg,3,f'{mode} q={samples[mode][i]["q"]:.3f}')for bg in bgs for i in inds];w,h=tiles[0].size;sheet=Image.new('RGB',(w*4,h*4))
 for i,t in enumerate(tiles):sheet.paste(t,((i%4)*w,(i//4)*h))
 sheet.save(O/f'{mode}-switch-detail.png')
