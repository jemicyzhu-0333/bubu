from pathlib import Path
from PIL import Image,ImageDraw
from collections import deque
import json,math,hashlib
ROOT=Path(__file__).resolve().parents[1];A=ROOT;O=ROOT/'joints';O.mkdir(exist_ok=True);m=json.loads((ROOT/'limbs.json').read_text());fs=m['segments']['arm-upper-l']['frames']+m['segments']['arm-fore-l']['frames'];INK=(26,27,38,255);PINK=(248,104,120,255)
def frame(kind,a):return next(f for f in fs if f['semantic']['segment']==kind and f['angle']==a)
def paste(c,f,root):c.alpha_composite(Image.open(A/f['src']),(int(root[0]-f['root'][0]),int(root[1]-f['root'][1])))
def pair(ua,fa):
 u=frame('upper',ua);f=frame('fore',fa);elbow=[24.5,24.5];root=[elbow[k]-(u['tip'][k]-u['root'][k])for k in(0,1)];upper=Image.new('RGBA',(49,49));fore=Image.new('RGBA',upper.size);paste(upper,u,root);paste(fore,f,elbow);before=Image.alpha_composite(upper,fore);after=before.copy();opaque={(x,y)for y in range(49)for x in range(49)if before.getpixel((x,y))[3]};overlap={p for p in opaque if upper.getpixel(p)[3]and fore.getpixel(p)[3]};seam=overlap|{(x+dx,y+dy)for x,y in overlap for dx in(-1,0,1)for dy in(-1,0,1)};outside={(0,0)};q=deque(outside)
 while q:
  x,y=q.popleft()
  for p in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if 0<=p[0]<49 and 0<=p[1]<49 and p not in opaque and p not in outside:outside.add(p);q.append(p)
 border={p for p in opaque if any((p[0]+dx,p[1]+dy)in outside for dx in(-1,0,1)for dy in(-1,0,1))};band={p for p in opaque if any(dx*dx+dy*dy<=4 and (p[0]+dx,p[1]+dy)in outside for dx in range(-2,3)for dy in range(-2,3))};edits=[]
 for x,y in sorted(opaque):
  if (x,y)not in seam:continue
  up=(x+.5-root[0])*math.cos(math.radians(ua))+(y+.5-root[1])*math.sin(math.radians(ua));fp=(x+.5-elbow[0])*math.cos(math.radians(fa))+(y+.5-elbow[1])*math.sin(math.radians(fa));protected=up<=1e-8 or fp>=4.5-1e-8;old=after.getpixel((x,y));new=old
  if old==INK and (x,y)not in band and (x,y)in overlap:new=PINK
  elif not protected and (x,y)in band:new=INK
  if old!=new:after.putpixel((x,y),new);edits.append({'xy':[x,y],'before':list(old),'after':list(new)})
 return u,f,elbow,root,before,after,edits
rows=[];sheet=Image.new('RGB',(16*100,16*100),'#f1f3ee');d=ImageDraw.Draw(sheet)
for ui in range(16):
 for fi in range(16):
  ua=ui*22.5;fa=fi*22.5;u,f,elbow,root,before,after,edits=pair(ua,fa);key=f'elbow-u{int(ua):03d}-f{int(fa):03d}';mask=Image.new('RGBA',(49,49));patch=Image.new('RGBA',(49,49));pivot=Image.new('RGBA',(49,49));pivot.putpixel((24,24),(255,0,0,255))
  for e in edits:mask.putpixel(tuple(e['xy']),(255,255,255,255));patch.putpixel(tuple(e['xy']),tuple(e['after']))
  paths={}
  for role,im in [('mask',mask),('patch',patch)]:
   filename=f'{key}-{role}.png';im.save(O/filename);im.resize((392,392),Image.Resampling.NEAREST).save(O/filename.replace('.png','@8x.png'));paths[role]='joints/'+filename;paths[role+'Production']='joints/'+filename.replace('.png','@8x.png')
  pivot.save(O/f'{key}.pivot.png');bend=abs((ua-fa+180)%360-180);rows.append({'key':key,'upperAngle':ua,'foreAngle':fa,'bendDegrees':bend,'allowedByBendLimit':bend<=150,'sourceUpper':u['src'],'sourceUpperSha256':u['sha256'],'sourceFore':f['src'],'sourceForeSha256':f['sha256'],'size':[49,49],'root':elbow,'upperRoot':root,'pivot':f'joints/{key}.pivot.png',**paths,'changedPixels':edits,'alphaUnchanged':before.getchannel('A').tobytes()==after.getchannel('A').tobytes()});z=after.crop((10,10,39,39)).resize((87,87),Image.Resampling.NEAREST);x=fi*100;y=ui*100;sheet.paste(z,(x+6,y+12),z);d.text((x+2,y+1),f'{int(ua)}/{int(fa)}',fill='#1a1b26'if bend<=150 else'#a22d2d')
sheet.save(O/'contact-sheet.png');(O/'elbow.json').write_text(json.dumps({'schema':'dango-elbow-pairs/2','sourceDirectory':'arm','layerOrder':['upper','fore','erase changed mask','patch'],'maskRole':'replace-overlap-colors','rule':'Actual source alpha union is preserved. Exterior ink distance is Euclidean <= 2 logical pixel centers. Repairs are restricted to actual overlap plus one pixel neighborhood. Open attachment planes prevent adding ink; original inner ink covered by both segments can be removed. Never draw disallowed bend pairs in runtime.','palette':{'ink':list(INK),'fill':list(PINK)},'frames':rows},indent=2)+'\n');print({'pairs':len(rows),'allowed':sum(r['allowedByBendLimit']for r in rows),'path':str(O)})
