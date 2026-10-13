#!/usr/bin/env python3
"""Rebuild accepted PNG layers from source crops, explicit transforms and reviewed edits.

Requires Python 3.10+ and Pillow. This is an offline asset compiler, not the app renderer.
"""
from pathlib import Path
from PIL import Image
import argparse,hashlib,json,math
ROOT=Path(__file__).resolve().parents[1]
COLORS={'root':(255,0,0,255),'tip':(0,255,0,255),'grip':(0,0,255,255),'sole':(255,255,0,255)}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p):return json.loads(p.read_text())
def sample(f,palette):
 source=ROOT/f['source'];assert sha(source)==f['sourceSha256'],f['source'];src=Image.open(source).convert('RGBA');im=Image.new('RGBA',f['size']);m=f['inverseSamplingMatrix']
 for y in range(im.height):
  for x in range(im.width):
   u=math.floor(m[0][0]*(x+.5)+m[0][1]*(y+.5)+m[0][2]);v=math.floor(m[1][0]*(x+.5)+m[1][1]*(y+.5)+m[1][2])
   if 0<=u<src.width and 0<=v<src.height:
    px=src.getpixel((u,v))
    if px[3]:px=(*min(palette,key=lambda c:sum((c[k]-px[k])**2 for k in range(3))),255)
    im.putpixel((x,y),px)
 for edit in f.get('pixelEdits',[]):
  xy=tuple(edit['xy']);assert list(im.getpixel(xy))==edit['before'],(f['src'],xy,'edit source mismatch');im.putpixel(xy,tuple(edit['after']))
 return im

def coverage(f):
 im=Image.new('RGBA',f['size']);body=f['sourceBody'];p=ROOT/body['src'];assert sha(p)==body['sha256'];src=Image.open(p).convert('RGBA');r=body['rect'];rect=f['usefulLocalRect']
 for y in range(rect[1],rect[3]):
  for x in range(rect[0],rect[2]):
   wx=f['worldRoot'][0]-f['root'][0]+x+.5;wy=f['worldRoot'][1]-f['root'][1]+y+.5;u=math.floor((wx-r[0])*src.width/r[2]);v=math.floor((wy-r[1])*src.height/r[3])
   if 0<=u<src.width and 0<=v<src.height and src.getpixel((u,v))[3]:im.putpixel((x,y),(255,255,255,255))
 return im

def save(im,path):path.parent.mkdir(parents=True,exist_ok=True);im.save(path)
def run(output,verify):
 recipe=load(ROOT/'sources/rebuild-recipe.json');palette=recipe['palette'];count=0
 for f in recipe['frames']:
  kind=f['semantic']['kind']
  if kind=='socket-patch':im=Image.new('RGBA',f['size'])
  elif kind=='socket-coverage':im=coverage(f)
  elif kind=='joint-reference':
   p=ROOT/f['source'];assert sha(p)==f['sourceSha256'];px=Image.open(p).convert('RGBA').getpixel(tuple(f['sourcePixel']));assert list(px)==f['sourceRGBA'];q=(*min(palette,key=lambda c:sum((c[k]-px[k])**2 for k in range(3))),255);im=Image.new('RGBA',f['size']);im.putpixel(tuple(int(z)for z in f['root']),q)
  else:im=sample(f,palette)
  save(im,output/f['src']);save(im.resize((im.width*8,im.height*8),Image.Resampling.NEAREST),output/f['productionSrc']);pivot=Image.new('RGBA',im.size)
  for key,color in COLORS.items():
   if key in f:pivot.putpixel(tuple(int(z)for z in f[key]),color)
  save(pivot,output/f['pivot'])
  if verify:
   assert sha(output/f['src'])==f['sha256'],(f['src'],'logical hash')
   for key in ['src','productionSrc','pivot']:assert Image.open(output/f[key]).tobytes()==Image.open(ROOT/f[key]).tobytes(),f[key]
  count+=1
 joints=load(ROOT/recipe['jointRecipe']); interfaces=load(ROOT/recipe['interfaceRecipe'])
 for f in joints['frames']+interfaces['frames']:
  # Pair masks are explicit, reviewed color replacements on unchanged alpha union.
  for key,white in [('mask',True),('patch',False)]:
   im=Image.new('RGBA',f['size'])
   for e in f['changedPixels']:im.putpixel(tuple(e['xy']),(255,255,255,255)if white else tuple(e['after']))
   save(im,output/f[key]);save(im.resize((im.width*8,im.height*8),Image.Resampling.NEAREST),output/f[key+'Production'])
  pivot=Image.new('RGBA',f['size']);pivot.putpixel(tuple(int(z)for z in f['root']),COLORS['root']);save(pivot,output/f['pivot'])
  if verify:
   for k in ['mask','patch','maskProduction','patchProduction','pivot']:assert Image.open(output/f[k]).tobytes()==Image.open(ROOT/f[k]).tobytes(),f[k]
 print(json.dumps({'baseFrames':count,'jointPairs':len(joints['frames']),'poseInterfaces':len(interfaces['frames']),'verified':verify,'output':str(output)},indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=ROOT/'rebuild-output',help='Destination for rebuilt PNGs; source assets are read-only.');p.add_argument('--verify',action='store_true',help='Compare rebuilt logical hashes and all image pixels against the delivered assets.');a=p.parse_args();run(a.output.resolve(),a.verify)
