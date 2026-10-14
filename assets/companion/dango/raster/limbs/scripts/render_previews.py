#!/usr/bin/env python3
from pathlib import Path
from PIL import Image,ImageDraw
import json,math,runpy,contextlib,io
ROOT=Path(__file__).resolve().parents[1]
import argparse,hashlib
parser=argparse.ArgumentParser(description="Render five current static poses from delivered layers and fixed rig registrations.")
parser.add_argument('--output',type=Path,required=True);parser.add_argument('--verify',action='store_true');args=parser.parse_args()
P=A=J=I=ROOT;O=args.output.resolve();O.mkdir(parents=True,exist_ok=True)
C=(108,86);OR=(16,10)
data=json.loads((ROOT/'sources/canonical/render-reference.json').read_text())
def layer(rec):
 source=Image.open(ROOT/rec['src']).convert('RGBA');assert hashlib.sha256((ROOT/rec['src']).read_bytes()).hexdigest()==rec['sha256'];rect=rec['rect'];out=Image.new('RGBA',C)
 for y in range(C[1]):
  for x in range(C[0]):
   u=math.floor((x-OR[0]+.5-rect[0])*source.width/rect[2]);v=math.floor((y-OR[1]+.5-rect[1])*source.height/rect[3])
   if 0<=u<source.width and 0<=v<source.height:out.putpixel((x,y),source.getpixel((u,v)))
 return out
allFrames=json.loads((ROOT/'sources/rebuild-recipe.json').read_text())['frames']
paws=[f for f in allFrames if f['semantic']['kind'] in ('paw','foot')];arms=[f for f in allFrames if f['semantic']['kind']=='segment']
rig=json.loads((ROOT/'validation/visual/rig-solutions.json').read_text());records=[]
joints=json.loads((ROOT/'joints/elbow.json').read_text())['frames'];interfaces=json.loads((ROOT/'interfaces/interfaces.json').read_text())['frames']

def place(canvas,im,root,world):canvas.alpha_composite(im,tuple(int(world[k]-root[k]+OR[k])for k in(0,1)))
def segment(kind,angle,side):
 fa=(180-angle)%360 if side=='right'else angle;f=next(x for x in arms if x['semantic']['segment']==kind and abs(x['angle']-fa)<1e-6);im=Image.open(A/f['src']);root=f['root']
 if side=='right':im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);root=[im.width-root[0],root[1]]
 return im,root,f
cases=[('standing','front',None),('holding-cup','front',None),('waving','front',None),('stepping','three-quarter-left','step'),('lifting','three-quarter-left','lift')]
sheet=Image.new('RGB',(5*340,430),'#f1f3ee');d=ImageDraw.Draw(sheet)
for ci,(name,view,activeFoot)in enumerate(cases):
 v=data['views'][view];canvas=Image.new('RGBA',C);hands=[];sols=[];socketEdits=[];bodyAlpha=layer(v['body']).getchannel('A')
 for side in ['left','right']:
  pose='hold-canonical-cup'if name=='holding-cup'else'wave'if name=='waving'and side=='left'else'rest';sol=next(x for x in rig['poses']if x['view']==view and x['side']==side and x['pose']==pose);sols.append(sol)
  armCanvas=Image.new('RGBA',C);foreCanvas=Image.new('RGBA',C);clipCandidates=[]
  for kind,world,angle in [('upper',sol['fixedShoulder'],sol['upperAngle']),('fore',sol['elbow'],sol['foreAngle'])]:
   im,root,f=segment(kind,angle,side)
   if kind=='upper':
    im=im.copy(); ux,uy=math.cos(math.radians(angle)),math.sin(math.radians(angle))
    for yy in range(im.height):
     for xx in range(im.width):
      projection=(xx+.5-root[0])*ux+(yy+.5-root[1])*uy
      cx,cy=int(world[0]-root[0]+OR[0]+xx),int(world[1]-root[1]+OR[1]+yy)
      if im.getpixel((xx,yy))[3] and projection<=1e-8 and (not(0<=cx<C[0]and 0<=cy<C[1])or bodyAlpha.getpixel((cx,cy))==0):
       socketEdits.append({'side':side,'segment':kind,'local':[xx,yy],'canvas':[cx,cy],'axialProjection':projection,'before':list(im.getpixel((xx,yy)))})
       clipCandidates.append((cx,cy))
   place(armCanvas,im,root,world)
   if kind=='fore':place(foreCanvas,im,root,world)
  ja=(180-sol['upperAngle'])%360 if side=='right'else sol['upperAngle'];jf=(180-sol['foreAngle'])%360 if side=='right'else sol['foreAngle'];j=next(j for j in joints if j['upperAngle']==ja and j['foreAngle']==jf);patch=Image.open(J/j['patch']);jr=j['root']
  if side=='right':patch=patch.transpose(Image.Transpose.FLIP_LEFT_RIGHT);jr=[patch.width-jr[0],jr[1]]
  # Patches change only opaque union colors, so direct overlay equals erase+patch here.
  place(armCanvas,patch,jr,sol['elbow'])
  for cx,cy in clipCandidates:
   if foreCanvas.getpixel((cx,cy))[3]==0:armCanvas.putpixel((cx,cy),(0,0,0,0))
  canvas.alpha_composite(armCanvas)
  pp='hold'if name=='holding-cup'else'wave'if name=='waving'and side=='left'else'rest';pa=0 if pp=='hold'else 225 if pp=='wave'else 180;f=next(x for x in paws if x['semantic']['kind']=='paw'and x['semantic']['pose']==pp and x['semantic']['view']==view and x['semantic']['nominalAngle']==pa);im=Image.open(P/f['src']);root=f['root'];grip=f['grip']
  appliedInterface=None
  if pp=='wave' and side=='left' and pa==225:
   interface=next((q for q in interfaces if q['verifiedPose']['view']==view),None)
   if interface:
    assert interface['sourcePawSha256']==f['sha256'];im=im.copy();im.alpha_composite(Image.open(I/interface['patch']));appliedInterface=interface['id']
  if side=='right':im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);root=[im.width-root[0],root[1]];grip=[im.width-grip[0],grip[1]]
  hand={'interface':appliedInterface,'im':im,'root':root,'world':sol['actualWrist'],'side':side,'frame':f['src'],'gripWorld':[sol['actualWrist'][k]+grip[k]-root[k]for k in(0,1)]};hands.append(hand)
  if view=='three-quarter-left'and side=='left':place(canvas,im,root,sol['actualWrist'])
 for side in ['left','right']:
  if activeFoot and side=='left':continue
  f=next(x for x in paws if x['semantic']['kind']=='foot'and x['semantic']['pose']=='stand'and x['semantic']['view']==view);im=Image.open(P/f['src']);root=f['root'];anchor=v['anchors']['foot-'+side];world=[math.floor(anchor[k])+.5 for k in ['x','y']]
  if side=='right':im=im.transpose(Image.Transpose.FLIP_LEFT_RIGHT);root=[im.width-root[0],root[1]]
  place(canvas,im,root,world)
 canvas.alpha_composite(layer(v['body']))
 for k in ['ear-left','ear-right']:canvas.alpha_composite(layer(v['parts'][k]))
 if 'neutral'in v.get('face',{}).get('eyes',{}):
  for rec in v['face']['eyes']['neutral']:canvas.alpha_composite(layer(rec))
  canvas.alpha_composite(layer(v['face']['mouth']['neutral']))
 if name=='holding-cup':
  cup=Image.open(ROOT/data['cup']['src']).convert('RGBA').resize((22,19),Image.Resampling.NEAREST);canvas.alpha_composite(cup,(22+OR[0],39+OR[1]))
 for h in hands:
  if view=='three-quarter-left'and h['side']=='left':continue
  place(canvas,h['im'],h['root'],h['world'])
 if activeFoot:
  pose='step-keypose'if activeFoot=='step'else'lift';f=next(x for x in paws if x['semantic']['kind']=='foot'and x['semantic']['pose']==pose and x['semantic']['view']=='three-quarter-left');im=Image.open(ROOT/f['src']);world=[20.5,52.5]if activeFoot=='step'else[18.5,51.5];place(canvas,im,f['root'],world)
 canvas.save(O/f'{name}-native.png');canvas.resize((C[0]*2,C[1]*2),Image.Resampling.NEAREST).save(O/f'{name}-2x.png');canvas.resize((C[0]*6,C[1]*6),Image.Resampling.NEAREST).save(O/f'{name}-6x-inspection.png');x=ci*340;sheet.paste(canvas,(x+8,28),canvas);big=canvas.resize((C[0]*2,C[1]*2),Image.Resampling.NEAREST);sheet.paste(big,(x+8,140),big);d.text((x+8,6),name+' | native +2x',fill='#1a1b26');records.append({'case':name,'view':view,'rig':sols,'socketClipping':{'rule':'Only upper open proximal half-space projection <= 0 is hidden where the actual canonical body alpha is zero. Positive-axis arm tissue, forearm and paw are unchanged.','edits':socketEdits},'hands':[{k:v for k,v in h.items()if k!='im'}for h in hands],'cup':{'size':[22,19],'origin':[22,39],'sourceAnchors':[[.875,10.375],[20.5,10.375]],'previewPixelContacts':[[1.5,10.5],[20.5,10.5]],'anchorQuantizationNote':'Cup and original targets are unchanged. Left wrist error is zero; right wrist/contact marker is one art unit left of its original target after the uniform shoulder revision. This static example does not pass exact bilateral contact.'}if name=='holding-cup'else None,'status':'Current rebuilt 6+6 composition with fixed shoulder registration and source-derived pair repair. Prior static images remain historical evidence. Static preview, not action/contact/native acceptance.'})
sheet.save(O/'actual-five-preview.png');(O/'registration.json').write_text(json.dumps(records,indent=2)+'\n');print(O)

if args.verify:
 for name,_,_ in cases:
  for suffix in ['native','2x']:
   fn=f'{name}-{suffix}.png';assert Image.open(O/fn).tobytes()==Image.open(ROOT/'validation/visual'/fn).tobytes(),fn
 print(json.dumps({'staticPoses':len(cases),'pixelIdenticalToCurrentRegisteredImages':True,'runtimeTested':False}))
