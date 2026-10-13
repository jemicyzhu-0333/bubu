from pathlib import Path
from PIL import Image,ImageDraw
import hashlib,json
import argparse
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);args=p.parse_args()
PACKAGE=Path(__file__).resolve().parents[1];ROOT=PACKAGE/'sources/provenance';OUT=args.output.resolve();OUT.mkdir(parents=True,exist_ok=True);SOURCE=PACKAGE/'sources/masters/low-cup-continuous-v2.png';im=Image.open(SOURCE).convert('RGBA');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert sha(SOURCE)=='bce60ee4e11ea4740f2243d62a45899bf004c28c436b03348772a4b57f1ac6ee'
# Reviewed anatomical polygon. Proximal cuts cross real pink forearm, not body or foot.
frames=[dict(side='left',polygon=[[390,708],[410,713],[430,725],[450,748],[470,769],[481,769],[512,769],[527,793],[537,811],[537,850],[527,870],[510,888],[492,900],[438,900],[428,892],[410,891],[396,880],[384,870],[372,859],[360,843],[347,819],[347,795],[339,784],[339,752],[348,753]],cut=[[390,708],[348,753]],contact=[538,835.5],normal=[1,0],targetLocal=[1.25,10.375],ownership='Cup owns wall to right; last source palm/shared ink through x537 retained.'),dict(side='right',polygon=[[902,708],[945,753],[953,788],[951,818],[938,842],[918,860],[899,876],[881,886],[860,900],[782,900],[771,890],[768,879],[757,865],[751,850],[751,822],[758,811],[769,802],[781,795],[791,794],[811,794],[810,787],[801,785],[792,780],[808,769],[825,750],[846,730],[864,720],[883,715]],cut=[[902,708],[945,753]],contact=[751,835.5],normal=[-1,0],targetLocal=[17.25,10.375],ownership='Inner-handle foreground palm. At row835 main vessel cream<=739, shared ink741..762, pink>=763; cup owns741..750 and palm owns751..762 by explicit convention. Registration x+17.25 remains occlusion hypothesis, not outer x+22.')]

checks=[];sheet=Image.new('RGBA',im.size,(230,230,230,255))
for f in frames:
 mask=Image.new('L',im.size);ImageDraw.Draw(mask).polygon([tuple(p)for p in f['polygon']],fill=255);
 if f['side']=='right':
  # Explicit reviewed cup-color exclusion, preserving source palm and its owned ink.
  for ya,yb,xmin in [(783,789,782),(790,796,787),(797,799,782),(800,801,778),(802,805,763),(806,809,760),(810,816,752),(865,867,760),(868,871,761),(872,874,765),(875,879,769),(880,881,770),(882,888,765)]:
   ImageDraw.Draw(mask).rectangle((0,ya,xmin-1,yb),fill=0)
  # Reviewed omitted pink fore/palm tissue, not cup connector colors.
  for ya,yb,xmin,xmax in [(786,786,800,805),(787,787,802,809),(788,790,809,809),(791,793,809,810)]:
   ImageDraw.Draw(mask).rectangle((xmin,ya,xmax,yb),fill=255)
 # Explicit independently reviewed additions recover master ink wrongly trimmed by v2.
 # Coordinates only: never infer an extraction region from RGB classification.
 for row in json.loads((ROOT/'v2b-upper-boundaries.json').read_text())['sides'][f['side']]['fixedUpperBoundaryRows']:
  span=row['addInclusiveX']
  if span: ImageDraw.Draw(mask).line((span[0],row['y'],span[1],row['y']),fill=255)
 # Actual straight open cut: retain only the distal half-plane of that source section.
 a,b=f['cut'];cross=lambda p:(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);sign=1 if cross(f['contact'])>0 else -1
 for yy in range(mask.height):
  for xx in range(mask.width):
   if mask.getpixel((xx,yy)) and sign*cross((xx+.5,yy+.5))<0:mask.putpixel((xx,yy),0)
 # Fixed reviewed source contour coordinates, no RGB keying during extraction.
 for xa,xb,lastY in json.loads((ROOT/'v2-outer-ink-boundaries.json').read_text())['sides'][f['side']]:
  ImageDraw.Draw(mask).rectangle((xa,lastY+1,xb,im.height-1),fill=0)
 box=mask.getbbox();crop=im.crop(box);m=mask.crop(box);a=Image.new('L',crop.size);a.putdata([x*y//255 for x,y in zip(crop.getchannel('A').getdata(),m.getdata())]);crop.putalpha(a);name=f['side']+'-source-rgba.png';crop.save(OUT/name);m.save(OUT/(f['side']+'-geometric-mask.png'));sheet.alpha_composite(crop,(box[0],box[1]));runs=[]
 for y in range(m.height):
  xs=[x for x in range(m.width)if m.getpixel((x,y))];
  if xs:runs.append([y,min(xs),max(xs)+1])
 f.update(sourceRgba=name,cropBox=list(box),maskRuns=runs,contactSource=f.pop('contact'),openProximalCutSource=f.pop('cut'),sourceRgbaSha256=sha(OUT/name));del f['polygon']
 orig=im.crop(box);checks.append({'side':f['side'],'rgbPreserved':all(p[:3]==q[:3]for p,q in zip(crop.getdata(),orig.getdata())),'maskedAlphaExact':all(p[3]==q[3]*v//255 for p,q,v in zip(crop.getdata(),orig.getdata(),m.getdata())),'sourceCutPixels':[im.getpixel(tuple(p))for p in f['openProximalCutSource']]})
sheet.crop((325,690,975,910)).save(OUT/'isolated-review.png');recipe={'schema':'sip-source-extraction/1','status':'IN-REVIEW v2b: observed upper ink recovered by fixed reviewed source coordinates; right contact and dynamic review remain pending','source':'sources/masters/low-cup-continuous-v2.png','sourceSha256':sha(SOURCE),'bodyWidthSource':969,'bodyWidthMeasurement':{'alphaThreshold':240,'rows':[450,500,550,580,600,650],'firstX':163,'lastXInclusive':1131,'width':969},'bodyWidthArt':69.415385,'bodyScale':69.415385/969,'frames':frames};(OUT/'extraction-recipe.json').write_text(json.dumps(recipe,indent=2));(OUT/'verification.json').write_text(json.dumps(checks,indent=2));print(checks)
