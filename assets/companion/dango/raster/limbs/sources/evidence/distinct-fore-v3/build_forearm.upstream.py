from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib,shutil
HERE=Path(__file__).resolve().parent
BASE=Path('/workspace/shared/bubu-limbs-runtime-v2-20261013/assets/companion/dango/raster/limbs')
OUT=HERE/'candidate-pack'
OUT.mkdir(exist_ok=True)
MASTER=HERE/'masters/short-arm-study-v2.png'
SCALE=69.415385/458
PAL=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
master=Image.open(MASTER).convert('RGBA');cropbox=[620,248,686,356];crop=master.crop(cropbox)
for y in range(crop.height):
 for x in range(crop.width):
  c=crop.getpixel((x,y));crop.putpixel((x,y),(*c[:3],255) if c[3]>=240 else (0,0,0,0))
source='sources/crops/distinct-fore-v3/fore-source-rgba.png';p=OUT/source;p.parent.mkdir(parents=True,exist_ok=True);crop.save(p)
rootSource=[634.5-cropbox[0],305.5-cropbox[1]]
recipe={'schema':'dango-source-distinct-fore/1','master':'sources/masters/short-arm-study-v2.png','masterSha256':sha(MASTER),'crop':cropbox,'alphaPolicy':'Geometric rectangular root/distal cuts; original RGB retained at source alpha >=240. Low-alpha generated background halo is excluded; no RGB color key.','bodyScaleAudit':{'sourceBodyWidthPx':458,'sampleRows':[230,240,250],'leftInclusive':150,'rightInclusive':607,'canonicalBodyWidthArt':69.415385,'artPxPerSourcePx':SCALE},'rootSourceCenter':[634.5,305.5],'tipSourceCenter':[634.5+6/SCALE,305.5],'boneControlLengthArt':6,'sourceRole':'New source-observed tapered distal forearm; upper remains distinct previously reviewed original source','candidateStatus':'Requires canonical assembly and joint review'}
rpath=OUT/'sources/evidence/distinct-fore-v3/source-recipe.json';rpath.parent.mkdir(parents=True,exist_ok=True);rpath.write_text(json.dumps(recipe,indent=2)+'\n')
frames=[];old=json.load(open(BASE/'limbs.json'))['segments']['arm-fore-l']['frames']
sheet=Image.new('RGB',(16*130,210),'#f1f3ee');d=ImageDraw.Draw(sheet)
for i,a in enumerate([i*22.5 for i in range(16)]):
 rad=math.radians(a);c,s=math.cos(rad),math.sin(rad);root=[15.5,15.5];mat=[[c/SCALE,s/SCALE,rootSource[0]-(c*root[0]+s*root[1])/SCALE],[-s/SCALE,c/SCALE,rootSource[1]-(-s*root[0]+c*root[1])/SCALE]]
 im=Image.new('RGBA',(31,31))
 for y in range(31):
  for x in range(31):
   u=math.floor(mat[0][0]*(x+.5)+mat[0][1]*(y+.5)+mat[0][2]);v=math.floor(mat[1][0]*(x+.5)+mat[1][1]*(y+.5)+mat[1][2])
   if 0<=u<crop.width and 0<=v<crop.height:
    px=crop.getpixel((u,v))
    if px[3]:im.putpixel((x,y),(*min(PAL,key=lambda q:sum((q[k]-px[k])**2 for k in range(3))),255))
 tip=[root[0]+round(6*c),root[1]+round(6*s)];src=f'arm/arm-fore-l-a{int(a):03d}.png';(OUT/'arm').mkdir(exist_ok=True);im.save(OUT/src);im.resize((248,248),Image.Resampling.NEAREST).save(OUT/src.replace('.png','@8x.png'));pivot=Image.new('RGBA',im.size);pivot.putpixel(tuple(map(int,root)),(255,0,0,255));pivot.putpixel(tuple(map(int,tip)),(0,255,0,255));pivot.save(OUT/src.replace('.png','.pivot.png'))
 f={'src':src,'productionSrc':src.replace('.png','@8x.png'),'pivot':src.replace('.png','.pivot.png'),'size':[31,31],'root':root,'tip':tip,'bounds':list(im.getbbox()),'angle':a,'boneControlLength':6,'actualGridBoneLength':math.hypot(tip[0]-root[0],tip[1]-root[1]),'gridAngleError':abs((math.degrees(math.atan2(tip[1]-root[1],tip[0]-root[0]))-a+180)%360-180),'rootOpaque':bool(im.getpixel(tuple(map(int,root)))[3]),'tipOpaque':bool(im.getpixel(tuple(map(int,tip)))[3]),'source':source,'sourceSha256':sha(OUT/source),'sourceRecipe':'sources/evidence/distinct-fore-v3/source-recipe.json','sourceRecipeSha256':sha(rpath),'inverseSamplingMatrix':mat,'sourceRootCenter':rootSource,'scaleArtPerSourcePixel':SCALE,'sha256':sha(OUT/src),'pixelEdits':[],'semantic':{'kind':'segment','segment':'fore','side':'l','nominalAngle':a,'boneLength':6,'shape':'Distinct source-observed tapered forearm from short-arm-study-v2; open root/distal cuts; no invented caps','status':'candidate awaiting runtime assembly'}};frames.append(f)
 prev=Image.open(BASE/old[i]['src']);sheet.paste(prev.resize((prev.width*3,prev.height*3),Image.Resampling.NEAREST),(i*130+5,20),prev.resize((prev.width*3,prev.height*3),Image.Resampling.NEAREST));big=im.resize((93,93),Image.Resampling.NEAREST);sheet.paste(big,(i*130+5,95),big);d.text((i*130+5,5),str(a),fill='black')
(OUT/'fore-frames.json').write_text(json.dumps(frames,indent=2)+'\n');sheet.save(HERE/'fore-old-new-review.png');print(json.dumps({'frames':len(frames),'rootTipOpaque':all(f['rootOpaque']and f['tipOpaque']for f in frames),'scale':SCALE,'sourceHash':sha(MASTER)}))
