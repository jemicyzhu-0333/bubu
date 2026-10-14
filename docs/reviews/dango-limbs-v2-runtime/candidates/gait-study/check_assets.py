import os
from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib,collections
O=Path(__file__).resolve().parent;d=json.load(open(O/'gait-source.json'));checks=[]
for f in d['frames']:
 im=Image.open(O/f['src']).convert('RGBA');big=Image.open(O/f['productionSrc']).convert('RGBA');alphas=sorted({p[3]for p in im.getdata()});cols=sorted({p[:3]for p in im.getdata()if p[3]});todo={(x,y)for y in range(im.height)for x in range(im.width)if im.getpixel((x,y))[3]};components=[]
 while todo:
  start=todo.pop();q=[start];num=0
  while q:
   x,y=q.pop();num+=1
   for dx in [-1,0,1]:
    for dy in[-1,0,1]:
     if (x+dx,y+dy)in todo:todo.remove((x+dx,y+dy));q.append((x+dx,y+dy))
  components.append(num)
 ok=alphas==[0,255]and set(cols).issubset({tuple(c)for c in d['palette']})and big.tobytes()==im.resize((im.width*8,im.height*8),Image.Resampling.NEAREST).tobytes()
 assert ok
 checks.append({'id':f['id'],'binaryAlpha':True,'paletteColors':len(cols),'exact8x':True,'alphaComponents8Connected':components,'rootOpaque':im.getpixel(tuple(int(v)for v in f['root']))[3]>0,'soleOpaque':im.getpixel(tuple(int(v)for v in f['sole']))[3]>0})
alphaHashes=[hashlib.sha256(Image.open(O/f['src']).getchannel('A').tobytes()).hexdigest()for f in d['frames']]
report={'frames':checks,'distinctRGBAHashes':len({f['sha256']for f in d['frames']}),'distinctAlphaHashes':len(set(alphaHashes)),'bodyModified':False,'runtimeIntegrated':False};(O/'asset-check.json').write_text(json.dumps(report,indent=2)+'\n')
phases=json.load(open(O/'phase-set.json'))['phases'];sheet=Image.new('RGB',(4*350,2*450),'#f1f3ee');dr=ImageDraw.Draw(sheet)
for row,bg in enumerate(['#f1f3ee','#202331']):
 dr.rectangle((0,row*450,1400,(row+1)*450),fill=bg)
 for col,phase in enumerate(phases):
  im=Image.open(O/(phase['name']+'-native.png'));x=col*350;y=row*450;ink='#1a1b26'if row==0 else'#f1f3ee';dr.text((x+5,y+3),phase['name'],fill=ink)
  for mul,yp in [(1.5,23),(3,170)]:
   v=im.resize((round(im.width*mul),round(im.height*mul)),Image.Resampling.NEAREST);sheet.paste(v,(x+5,y+yp),v)
  dr.text((x+5,y+432),'99 / 198 CSS px body DESIGN width',fill=ink)
sheet.save(O/'canonical-phase-css-light-dark.png')
for name in ['run-quarter-right-v1','run-quarter-right-v2','run-contact-study-v3']:
 p=O/'masters'/f'{name}.png';im=Image.open(p);refs=(json.load(open(O/'references/order.json'))if name.endswith('v1')else [{'order':i+1,'path':str(x),'sha256':hashlib.sha256(x.read_bytes()).hexdigest()}for i,x in enumerate(([O/'masters/run-quarter-right-v1.png',Path(os.environ['DANGO_CANONICAL_PACKAGE']) / 'sources/masters/full-character-v2.png',O/'references/canonical-quarter-right-step.png']if name.endswith('v2')else [Path(os.environ['DANGO_CANONICAL_PACKAGE']) / 'sources/masters/full-character-v2.png',O/'references/canonical-quarter-right-step.png']))])
 record={'tool':'official image_gen.imagegen','master':str(p.relative_to(O)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'dimensions':im.size,'mode':im.mode,'prompt':str(p.with_name(name+'-prompt.txt').relative_to(O)),'promptSha256':hashlib.sha256(p.with_name(name+'-prompt.txt').read_bytes()).hexdigest(),'referencesInAttachmentOrder':refs,'seed':None,'modelVersion':None,'status':'rejected as complete gait'if name!='run-contact-study-v3'else'accepted source anatomy candidate; not standalone complete gait'};p.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(report,indent=2))
