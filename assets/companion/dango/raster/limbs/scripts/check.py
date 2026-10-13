#!/usr/bin/env python3
"""Read-only checks for the delivered asset pack; not an application or motion test."""
from pathlib import Path
from PIL import Image
import argparse,hashlib,json,math
ROOT=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def main():
 recipe=read(ROOT/'sources/rebuild-recipe.json');palette={tuple(c)for c in recipe['palette']};frames=recipe['frames'];assert len(frames)==240;seen=set();cache={}
 for f in frames:
  assert f['src']not in seen;seen.add(f['src']);im=Image.open(ROOT/f['src']).convert('RGBA');assert list(im.size)==f['size'];assert sha(ROOT/f['src'])==f['sha256'];pixels=list(im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata());assert {p[3]for p in pixels}<={0,255};visible={p[:3]for p in pixels if p[3]};kind=f['semantic']['kind'];assert visible<=({(255,255,255)}if kind=='socket-coverage'else palette)
  box=im.getbbox()
  if box:assert min(box[0],box[1],im.width-box[2],im.height-box[3])>=2
  else:assert kind=='socket-patch'and f['noOp']
  assert Image.open(ROOT/f['productionSrc']).tobytes()==im.resize((im.width*8,im.height*8),Image.Resampling.NEAREST).tobytes();pv=Image.new('RGBA',im.size)
  for key,color in [('root',(255,0,0,255)),('tip',(0,255,0,255)),('grip',(0,0,255,255)),('sole',(255,255,0,255))]:
   if key in f:
    pt=f[key];assert all(abs(z-math.floor(z)-.5)<1e-8 for z in pt);pv.putpixel(tuple(int(z)for z in pt),color)
  assert pv.tobytes()==Image.open(ROOT/f['pivot']).tobytes()
  for key,hkey in [('source','sourceSha256'),('sourceRecipe','sourceRecipeSha256')]:
   if key in f:
    p=ROOT/f[key];cache.setdefault(str(p),sha(p));assert cache[str(p)]==f[hkey]
 joints=read(ROOT/'joints/elbow.json');assert len(joints['frames'])==256;assert sum(f['allowedByBendLimit']for f in joints['frames'])==208
 for f in joints['frames']:
  assert f['allowedByBendLimit']==(abs((f['upperAngle']-f['foreAngle']+180)%360-180)<=150)
  for pathkey,hashkey in [('sourceUpper','sourceUpperSha256'),('sourceFore','sourceForeSha256')]:assert sha(ROOT/f[pathkey])==f[hashkey]
  for role in ['mask','patch']:
   im=Image.open(ROOT/f[role]);expect=Image.new('RGBA',f['size'])
   for edit in f['changedPixels']:expect.putpixel(tuple(edit['xy']),(255,255,255,255)if role=='mask'else tuple(edit['after']))
   assert im.tobytes()==expect.tobytes();assert Image.open(ROOT/f[role+'Production']).tobytes()==im.resize((im.width*8,im.height*8),Image.Resampling.NEAREST).tobytes()
  pv=Image.new('RGBA',f['size']);pv.putpixel(tuple(int(z)for z in f['root']),(255,0,0,255));assert pv.tobytes()==Image.open(ROOT/f['pivot']).tobytes()
 interfaces=read(ROOT/'interfaces/interfaces.json');assert len(interfaces['frames'])==3
 for f in interfaces['frames']:
  source=Image.open(ROOT/f['sourcePaw']).convert('RGBA');assert sha(ROOT/f['sourcePaw'])==f['sourcePawSha256']
  for role in ['mask','patch']:
   expected=Image.new('RGBA',f['size'])
   for edit in f['changedPixels']:
    assert list(source.getpixel(tuple(edit['xy'])))==edit['before'];assert edit['before'][3]==edit['after'][3]==255
    expected.putpixel(tuple(edit['xy']),(255,255,255,255)if role=='mask'else tuple(edit['after']))
   assert expected.tobytes()==Image.open(ROOT/f[role]).tobytes()
   assert expected.resize((expected.width*8,expected.height*8),Image.Resampling.NEAREST).tobytes()==Image.open(ROOT/f[role+'Production']).tobytes()
 result={'baseFrames':240,'jointPairs':256,'legalJointPairs':208,'assetChecks':'passed','runtimeTested':False,'limitations':['Fixed-surface support retains up to 1.662799 art-unit discrete wrist-target error.','Direction layers are not a walking cycle.','Application adapters and action-specific occlusion need integration.']};print(json.dumps(result,indent=2))
if __name__=='__main__':
 argparse.ArgumentParser(description=__doc__).parse_args();main()
