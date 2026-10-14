from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib
HERE=Path(__file__).resolve().parent; SRC=HERE/'v7-continuous-extraction'; OUT=HERE/'v7-front-hiccup-pose'; OUT.mkdir(exist_ok=True)
D=json.loads((SRC/'extraction-recipe.json').read_text()); V=json.loads((SRC/'verification.json').read_text()); assert D['status'].startswith('reviewed-source-extraction-only')
PAL=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]; scale=D['bodyScale']; sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
frames=[];sheet=Image.new('RGB',(528,576),'#edeae3')
for f in D['frames']:
 side=f['side'];check=next(c for c in V['checks'] if c['side']==side);path=SRC/f['sourceRgba'];assert sha(path)==check['rgbaSha256'];crop=Image.open(path).convert('RGBA');box=f['cropBox'];C=f['contactSource'];T=[23.25,48.375] if side=='left' else [44.0,48.375];S=[4.5,45.5] if side=='left' else [61.5,45.5]
 def world(p):return [T[k]+(p[k]-C[k])*scale for k in range(2)]
 cut=list(map(world,f['openProximalCutSource']));P=[sum(p[k] for p in cut)/2 for k in range(2)];im=Image.new('RGBA',(66,72));mat=[[1/scale,0,C[0]-box[0]-T[0]/scale],[0,1/scale,C[1]-box[1]-T[1]/scale]]
 for y in range(72):
  for x in range(66):
   u=math.floor((x+.5-T[0])/scale+C[0]-box[0]);v=math.floor((y+.5-T[1])/scale+C[1]-box[1])
   if 0<=u<crop.width and 0<=v<crop.height:
    px=crop.getpixel((u,v))
    if px[3]>=240:im.putpixel((x,y),(*min(PAL,key=lambda p:sum((p[k]-px[k])**2 for k in range(3))),255))
 name=f'hiccup-front-{side}-continuous.png';im.save(OUT/name);im.resize((528,576),Image.Resampling.NEAREST).save(OUT/name.replace('.png','@8x.png'))
 marker=Image.new('RGBA',im.size);marker.putpixel(tuple(map(int,S)),(255,0,0,255));marker.putpixel(tuple(map(int,P)),(0,255,0,255));marker.putpixel(tuple(map(int,T)),(0,128,255,255));marker.save(OUT/name.replace('.png','.pivot.png'))
 layers=im.resize((528,576),Image.Resampling.NEAREST);sheet.paste(layers,(0,0),layers)
 frame={'side':side,'src':name,'productionSrc':name.replace('.png','@8x.png'),'sha256':sha(OUT/name),'size':[66,72],'origin':[0,0],'bounds':list(im.getbbox()),'source':'../v7-continuous-extraction/'+f['sourceRgba'],'sourceSha256':sha(path),'sourceMasterSha256':D['sourceSha256'],'sourceBodyWidth':D['bodyWidthSource'],'scaleArtPerSourcePixel':scale,'sourceContactBoundary':C,'observedContactBoundary':T,'normal':f['normal'],'sourceOpenCut':f['openProximalCutSource'],'worldOpenCut':cut,'visibleProximalCutCenter':P,'anatomicalShoulder':S,'hiddenContinuation':{'from':S,'to':P,'length':math.dist(S,P),'measuredFullWidth':math.dist(*cut),'coverageStatus':'requires actual canonical positive-width body coverage; no internal pixels synthesized'},'sourceToWorldMatrix':[[scale,0,T[0]-C[0]*scale],[0,scale,T[1]-C[1]*scale]],'inverseSamplingMatrix':mat,'ownership':f['ownership'],'sourceObservedForeContour':True,'oldHandleAxisSatisfied':False if side=='right' else None,'candidateOnly':True}
 frames.append(frame)
(OUT/'frames.json').write_text(json.dumps({'schema':'dango-source-contact-pose-candidate/1','runtimeReady':False,'action':'hiccup','view':'front','toolRegistration':{'key':'cup','x':22,'y':38,'rect':[0,0,22,19]},'sourceExtractionStatus':D['status'],'pixelPolicy':'Original geometric source crop, source-alpha>=240, nearest existing four-color palette, one isotropic body scale, offline inverse sample; no runtime rotation/stretch, no contour edits.','frames':frames},indent=2)+'\n');sheet.save(OUT/'isolated-contact-layers-8x.png');print([(f['side'],f['bounds'],f['visibleProximalCutCenter'],f['hiddenContinuation'])for f in frames])
