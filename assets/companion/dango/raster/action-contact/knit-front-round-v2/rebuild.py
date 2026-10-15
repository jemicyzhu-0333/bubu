#!/usr/bin/env python3
# PET_VISUAL「手部与动作」: frozen local hand material; uniform stroke-priority quantization.
import argparse
from PIL import Image,ImageDraw
from pathlib import Path
from collections import defaultdict
import json,math,hashlib
b=Path(__file__).resolve().parent;ap=argparse.ArgumentParser();ap.add_argument('--out-dir',type=Path,default=b);args=ap.parse_args();src=b/'sources';out=args.out_dir;out.mkdir(parents=True,exist_ok=True);raw=Image.open(src/'generated-master-v1.png').convert('RGBA');pal=[(26,27,38),(240,80,104),(248,104,120),(248,128,128)];scale=1/18
polys={'left':[(398,465),(600,465),(600,625),(398,625)],'right':[(758,465),(944,465),(944,625),(758,625)]}
propExclusions={
'left':[[(398,465),(474,465),(474,481),(460,495),(446,507),(426,518),(398,518)],[(579,558),(600,558),(600,625),(543,625),(543,604),(553,591),(553,582),(563,582),(563,573),(573,563)]],
'right':[[(879,465),(944,465),(944,518),(909,518),(898,506),(887,495),(879,483)],[(758,558),(777,558),(777,571),(793,571),(793,582),(803,582),(803,594),(815,606),(815,625),(758,625)]]}

parts={};eligible=[]
for side,poly in polys.items():
 mask=Image.new('L',raw.size);ImageDraw.Draw(mask).polygon(poly,fill=255)
 for exclude in propExclusions[side]:ImageDraw.Draw(mask).polygon(exclude,fill=0)
 assert mask.tobytes()==Image.open(src/f'{side}-mask.png').convert('L').tobytes(), 'frozen mask mismatch'
 # Grip is the observed palm-fill centroid projected to its measured source shaft line.
 box=(425,470,594,618) if side=='left' else (765,470,915,618);pink=[]
 for yy in range(box[1],box[3]):
  for xx in range(box[0],box[2]):
   zz=raw.getpixel((xx,yy))
   if mask.getpixel((xx,yy)) and zz[3]>=128 and zz[0]>150 and zz[1]<170 and zz[2]<185:pink.append((xx+.5,yy+.5))
 centroid=(sum(x for x,y in pink)/len(pink),sum(y for x,y in pink)/len(pink));m,c=(.932490490263611,58.85568663596956) if side=='left' else (-.7629959919407641,1181.1505119760823);gx=(centroid[0]+m*(centroid[1]-c))/(1+m*m);sp=(gx,m*gx+c);tp=(26.75,45.125) if side=='left' else (42.25,45.125)
 sourceAngle=math.degrees(math.atan(.932490490263611)) if side=='left' else 180+math.degrees(math.atan(-.7629959919407641));targetAngle=40.904384747518755 if side=='left' else 180-40.904384747518755;rot=math.radians(targetAngle-sourceAngle);co,si=math.cos(rot),math.sin(rot);cells=defaultdict(lambda:{'counts':[0]*4,'sourcePixels':[]});contam=[]
 for y in range(raw.height):
  for x in range(raw.width):
   z=raw.getpixel((x,y))
   if not mask.getpixel((x,y)) or z[3]<128:continue
   if min(z[:3])>150:contam.append([x,y,list(z)])
   q=min(range(4),key=lambda k:sum((pal[k][i]-z[i])**2 for i in range(3)));dx=x+.5-sp[0];dy=y+.5-sp[1];xy=(math.floor(tp[0]+scale*(co*dx-si*dy)),math.floor(tp[1]+scale*(si*dx+co*dy)));c=cells[xy];c['counts'][q]+=1;c['sourcePixels'].append([x,y])
 for xy,c in cells.items():
  c['xy']=xy;c['alphaCoverage']=sum(c['counts'])/324;c['inkCoverage']=c['counts'][0]/324
  if c['alphaCoverage']>=.5:eligible.append(c)
 parts[side]={'sourceGrip':sp,'sourcePalmFillCentroid':centroid,'sourcePalmROI':box,'worldGrip':tp,'sourceShaftAngle':sourceAngle,'targetShaftAngle':targetAngle,'offlineRotationDegrees':targetAngle-sourceAngle,'maskPolygon':poly,'propExclusions':propExclusions[side],'lightPropContamination':contam,'sourceAlphaArtArea':sum(sum(c['counts']) for c in cells.values())/324,'sourceInkArtArea':sum(c['counts'][0] for c in cells.values())/324,'cells':list(cells.values())}
target=sum(r['sourceInkArtArea'] for r in parts.values());choices=sorted(set(c['inkCoverage'] for c in eligible if c['inkCoverage']>0));tau=.2 # Parent-approved single uniform readability rule; explicitly records ink-area inflation.
for side,r in parts.items():
 im=Image.new('RGBA',(72,72));selected=[]
 for c in r['cells']:
  x,y=c['xy']
  if not(0<=x<72 and 0<=y<72) or (c['inkCoverage']<tau and c['alphaCoverage']<.5):continue
  k=0 if c['inkCoverage']>=tau else max(range(1,4),key=lambda k:c['counts'][k]);im.putpixel((x,y),pal[k]+(255,));selected.append({'xy':[x,y],'rgba':pal[k]+(255,)})
 im.save(out/f'{side}-logical.png');im.resize((576,576),Image.Resampling.NEAREST).save(out/f'{side}-8x.png');r['logical']=selected;r['logicalInkArea']=sum(z['rgba'][:3]==pal[0] for z in selected);r['logicalAlphaArea']=len(selected);r['bounds']=im.getbbox()
recipe={'master':str(src/'generated-master-v1.png'),'masterSha256':hashlib.sha256((src/'generated-master-v1.png').read_bytes()).hexdigest(),'scale':scale,'palette':pal,'sourceAlphaThreshold':128,'logicalAlphaCoverage':.5,'globalInkCoverageThreshold':tau,'inkRule':'Stroke priority: every cell with source ink coverage >=.2 survives independently of alpha coverage; otherwise fill requires alpha coverage >=.5. One common rule, no per-cell override. Roughly 100% ink area increase rounds subpixel strokes to readable one-pixel contours, not source-pixel equality; see recorded source and logical areas.','projection':'One uniform offline scale with per-hand rigid shaft-angle alignment; one coverage quantization; exact NN8x export. Runtime translation only.','scaleReason':'Source palms about140–160 by140 px become7.8–8.9 by7.8 art units, comparable to accepted umbrella8x9 and legacy paw9.2x6.7. Source generated needle lengths are not consumed; measured shaft axes register to unchanged original needle axis.','parts':parts};print({'tau':tau,'parts':{s:{k:r[k] for k in ['sourceAlphaArtArea','sourceInkArtArea','logicalAlphaArea','logicalInkArea','bounds','offlineRotationDegrees','lightPropContamination']} for s,r in parts.items()}})
