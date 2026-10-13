from pathlib import Path
from PIL import Image,ImageDraw,ImageChops,ImageFont
import json,hashlib
O=Path(__file__).resolve().parent;S=O.parent/'masters/hold-visible-fore-v7.png';im=Image.open(S).convert('RGBA');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(S)=='c9eeb81908d4f1350053f67e90dd7477898b8b72958b832ca8928353cf29ff94', 'source master changed'
# Geometric contour vertices transcribed from source ink edge inspection. No RGB key.
polygons={'left':[(444,741),(450,741),(450,749),(461,749),(461,757),(483,757),(483,765),(501,765),(501,763),(525,763),(525,771),(539,771),(539,778),(546,778),(546,824),(539,824),(539,833),(533,833),(533,841),(523,841),(523,850),(478,850),(478,841),(458,841),(458,834),(448,834),(448,826),(439,826),(439,815)],'right':[(807,741),(813,741),(813,751),(810,751),(810,757),(795,757),(795,759),(794,759),(794,767),(779,767),(779,775),(732,775),(732,779),(722,779),(722,788),(714,788),(714,822),(722,822),(722,832),(726,832),(726,835),(732,835),(732,843),(777,843),(777,833),(794,833),(794,824),(807,824),(807,815),(817,815),(817,825)]}
# Right top must retain observed paw top to the handle from x732 at y767.
polygons['right']=[(813,741),(807,741),(807,749),(794,749),(794,757),(777,757),(777,767),(732,767),(732,779),(722,779),(722,788),(714,788),(714,822),(722,822),(722,833),(732,843),(732,852),(776,852),(776,842),(793,842),(793,832),(807,832),(807,824),(816,824),(816,815)]
frames=[];masks=[]
for side,p in polygons.items():
 m=Image.new('L',im.size);d=ImageDraw.Draw(m);d.polygon(p,fill=255)
 if side=='left':
  # Explicit reviewed source-edge row corrections; not RGB-derived masks.
  d.line((534,771,550,771),fill=0);d.line((540,778,550,778),fill=0)
  d.line((547,779,547,824),fill=255)
  for ya,yb,x0,x1 in [(826,833,448,539),(834,839,458,532),(840,840,459,532),(841,849,478,522)]:
   for y in range(ya,yb+1):
    d.line((430,y,x0-1,y),fill=0);d.line((x1+1,y,550,y),fill=0)
  d.line((430,850,550,850),fill=0)
 if side=='right':
  for y in range(844,853):d.line((731,y,776,y),fill=255)
 box=m.getbbox();mask=m.crop(box);cut=im.crop(box);cut.putalpha(ImageChops.multiply(cut.getchannel('A'),mask));cut.save(O/f'{side}-source-rgba.png');mask.save(O/f'{side}-geometric-mask.png');frames.append({'side':side,'polygon':p,'cropBox':list(box),'sourceRgba':f'{side}-source-rgba.png','mask':f'{side}-geometric-mask.png','opaqueBoundsSource':[box[2]-box[0],box[3]-box[1]],'boundsArt':[(box[2]-box[0])*69.415385/678,(box[3]-box[1])*69.415385/678]});masks.append(m)
box=(420,725,835,865);crop=im.crop(box);base=Image.new('RGBA',crop.size,'#eeece6');base.alpha_composite(crop);overlay=base.copy()
for m in masks:
 a=m.crop(box).point(lambda n:90 if n else 0);color=Image.new('RGBA',crop.size,(0,190,190,0));color.putalpha(a);overlay.alpha_composite(color)
W=1245;sheet=Image.new('RGB',(W,1325),'#eeece6');sheet.paste(base.resize((W,420),Image.Resampling.NEAREST),(0,45));sheet.paste(overlay.resize((W,420),Image.Resampling.NEAREST),(0,510));d=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18);d.text((10,10),'V7 continuous fore+palm original source 3x',font=font,fill='#222');d.text((10,475),'Teal: geometric mask. Proximal cuts open. Source RGB/alpha preserved.',font=font,fill='#222')
for i,f in enumerate(frames):
 cut=Image.open(O/f['sourceRgba']);b=Image.new('RGBA',cut.size,'#41444b');b.alpha_composite(cut);sheet.paste(b.resize((cut.width*3,cut.height*3),Image.Resampling.NEAREST),(i*620+150,980))
sheet.save(O/'review-overlay.png');(O/'extraction-recipe.json').write_text(json.dumps({'source':str(S),'sourceSha256':sha(S),'sourceSize':list(im.size),'bodyWidthSource':678,'bodyScale':69.415385/678,'status':'reviewed-source-extraction-only; canonical composition and fixed shoulder acceptance outstanding','frames':frames},indent=2));print([(f['side'],f['boundsArt'])for f in frames])

# Reproducible pixel/alpha verification and explicit contact metadata.
recipe=json.loads((O/'extraction-recipe.json').read_text());checks=[]
for f in recipe['frames']:
 side=f['side'];f['contactSource']=[548.0,800.5] if side=='left' else [714.0,800.5];f['contactConvention']='source continuous pixel edge in x, row center in y';f['normal']=[1,0] if side=='left' else [-1,0];f['ownership']='Left palm owns shared vessel-edge ink through x547 at row800.' if side=='left' else 'Right cup owns shaft ink x706..713; palm begins x714. Axis reference709.5 is not palm contact.';f['openProximalCutSource']=[[444,741],[439,815]] if side=='left' else [[813,741],[816,815]];f['sourceObservedForeRunArtApprox']=5.0;f['bodyPixelsOutsideContourAdded']=False
 maskFull=Image.open(O/f['mask']);f['geometricScanlines']=[]
 for yy in range(maskFull.height):
  xx=[x for x in range(maskFull.width) if maskFull.getpixel((x,yy))];
  if xx:
   runs=[];a=b=xx[0]
   for x in xx[1:]:
    if x==b+1:b=x
    else:runs.append([a+f['cropBox'][0],b+f['cropBox'][0]]);a=b=x
   runs.append([a+f['cropBox'][0],b+f['cropBox'][0]]);f['geometricScanlines'].append({'sourceY':yy+f['cropBox'][1],'inclusiveSourceXRanges':runs})
 out=Image.open(O/f['sourceRgba']).convert('RGBA');raw=im.crop(f['cropBox']);mask=Image.open(O/f['mask']);assert out.convert('RGB').tobytes()==raw.convert('RGB').tobytes();expected=ImageChops.multiply(raw.getchannel('A'),mask);assert expected.tobytes()==out.getchannel('A').tobytes();checks.append({'side':side,'sourceRgbExact':True,'retainedSourceAlphaExact':True,'rgbaSha256':sha(O/f['sourceRgba']),'maskSha256':sha(O/f['mask'])})
recipe['rightHandleAxisReference']=[709.5,800.5];recipe['restrictions']=['Do not substitute source body or cup','No wrist cap or fabricated hidden palm','No fixed shoulder move','No scaling fore separately from source body scale','Source contact does not prove old canonical axis-grip match'];recipe['extractionMethod']='Recorded geometric polygon with explicit source-row corrections; no RGB key, recolor or generated pixels.'
(O/'extraction-recipe.json').write_text(json.dumps(recipe,indent=2)+'\n');(O/'verification.json').write_text(json.dumps({'sourceSha256':sha(S),'checks':checks},indent=2)+'\n')
