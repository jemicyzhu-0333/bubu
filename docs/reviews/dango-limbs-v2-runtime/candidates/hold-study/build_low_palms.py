from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib
H=Path(__file__).resolve().parent; O=H/'low-canonical-candidate'; O.mkdir(exist_ok=True)
recipe=json.loads((H/'low-palm-extraction/extraction-recipe.json').read_text()); PAL=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]
checks=json.loads((H/'low-palm-extraction/verification.json').read_text())['checks']
for check in checks:
 assert hashlib.sha256((H/'low-palm-extraction'/f"{check['side']}-source-rgba.png").read_bytes()).hexdigest()==check['rgbaSha256'], 'reviewed source crop changed'
frames=[];sheet=Image.new('RGB',(460,220),'#eeeae2');draw=ImageDraw.Draw(sheet)
for i,f in enumerate(recipe['frames']):
 side=f['side'];crop=Image.open(H/'low-palm-extraction'/f['sourceRgba']).convert('RGBA');scale=f['uniformScale'];box=f['cropBox'];rs=[230.5,534.5] if side=='left' else [558.5,535.5];root=[15.5,15.5];rsl=[rs[0]-box[0],rs[1]-box[1]];im=Image.new('RGBA',(31,31))
 for y in range(31):
  for x in range(31):
   u=math.floor((x+.5-root[0])/scale+rsl[0]);v=math.floor((y+.5-root[1])/scale+rsl[1])
   if 0<=u<crop.width and 0<=v<crop.height:
    c=crop.getpixel((u,v))
    if c[3]:im.putpixel((x,y),(*min(PAL,key=lambda p:sum((p[k]-c[k])**2 for k in range(3))),255))
 ideal=[root[k]+(f['contactSource'][k]-rs[k])*scale for k in range(2)]
 pts=[(x+.5,y+.5) for y in range(31) for x in range(31) if im.getpixel((x,y))[3]]
 grip=min(pts,key=lambda p:sum((p[k]-ideal[k])**2 for k in range(2)));name=f'cup-low-{side}.png';im.save(O/name);im.resize((248,248),Image.Resampling.NEAREST).save(O/name.replace('.png','@8x.png'))
 pivot=Image.new('RGBA',im.size);pivot.putpixel(tuple(map(int,root)),(255,0,0,255));pivot.putpixel(tuple(map(int,grip)),(0,128,255,255));pivot.save(O/name.replace('.png','.pivot.png'))
 assert im.getpixel(tuple(map(int,root)))[3], 'wrist control must be source-opaque'
 frames.append({'rootOpaque':True,'src':name,'productionSrc':name.replace('.png','@8x.png'),'root':root,'grip':grip,'idealObservedBoundary':ideal,'gripRole':'nearest opaque display marker to observed boundary; NOT shaft-axis grip','normal':f['normal'],'angle':0 if side=='left' else 180,'side':side,'size':list(im.size),'bounds':list(im.getbbox()),'source':'../low-palm-extraction/'+f['sourceRgba'],'sourceSha256':hashlib.sha256((H/'low-palm-extraction'/f['sourceRgba']).read_bytes()).hexdigest(),'sourceRootCenter':rs,'sourceContactBoundary':f['contactSource'],'scaleArtPerSourcePixel':scale,'inverseSamplingMatrix':[[1/scale,0,rsl[0]-root[0]/scale],[0,1/scale,rsl[1]-root[1]/scale]],'ownership':f['ownership'],'candidateOnly':True})
 big=im.resize((186,186),Image.Resampling.NEAREST);sheet.paste(big,(i*230,25),big);draw.text((i*230+5,5),side+' / source-sized',fill='black')
(O/'frames.json').write_text(json.dumps(frames,indent=2)+'\n');sheet.save(O/'review.png');print(json.dumps(frames,indent=2))
