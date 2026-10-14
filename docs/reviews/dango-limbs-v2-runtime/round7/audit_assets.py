import json, hashlib, os, collections
from PIL import Image
# python3 docs/reviews/dango-limbs-v2-runtime/round7/audit_assets.py -> round7/asset-audit.json
HERE=os.path.dirname(os.path.abspath(__file__))
R=os.path.join(HERE,'../../../../assets/companion/dango/raster/limbs')
os.chdir(R)
probs=collections.defaultdict(list)
seal=json.load(open('FILES.sha256.json'))['files']
seal = seal if isinstance(seal,dict) else {e['path']:e['sha256'] for e in seal}
# 1 seal
for p,h in seal.items():
  q=p.split('limbs/',1)[-1] if p.startswith('assets/') else p
  if not os.path.exists(q): probs['missing-sealed'].append(p); continue
  if hashlib.sha256(open(q,'rb').read()).hexdigest()!=h: probs['sha-mismatch'].append(p)
allf=[os.path.relpath(os.path.join(d,f)) for d,_,fs in os.walk('.') for f in fs]
sealset={ (p.split('limbs/',1)[-1] if p.startswith('assets/') else p) for p in seal}
for f in allf:
  if f not in sealset and f!='FILES.sha256.json': probs['unsealed'].append(f)
m=json.load(open('limbs.json'))
PAL={tuple(int(c[i:i+2],16) for i in (1,3,5)) for c in m['grid']['palette']}
refs=[]
def walk(o,path=''):
  if isinstance(o,dict):
    for k,v in o.items(): walk(v,path+'.'+k)
  elif isinstance(o,list):
    for i,v in enumerate(o): walk(v,f'{path}[{i}]')
  elif isinstance(o,str) and o.endswith('.png'): refs.append((path,o))
walk(m); 
for side in ['joints/elbow.json','interfaces/interfaces.json']: walk(json.load(open(side)),side)
for path,src in refs:
  if not os.path.exists(src): probs['ref-missing'].append(f'{path} -> {src}')
# frames checks
def frames():
  for k,s in m['segments'].items():
    for f in s.get('frames',[s] if 'src' in s else []): yield 'segments.'+k,f
  for grp in ('paws','feet'):
    for pose,d in m[grp].items():
      for v,l in d['views'].items():
        for f in l: yield f'{grp}.{pose}.{v}',f
  for s in m['sockets']: yield f"sockets.{s['kind']}.{s['view']}.{s['side']}",s
hashes=collections.defaultdict(list)
for path,f in frames():
  src=f['src']
  if not os.path.exists(src): continue
  im=Image.open(src).convert('RGBA'); w,h=im.size
  if [w,h]!=list(f['size']): probs['size-mismatch'].append(f'{src} {w}x{h} vs {f["size"]}')
  for key in ('root','tip','grip','sole'):
    if key in f:
      x,y=f[key]
      if not (0<=x<=w and 0<=y<=h): probs['anchor-outside'].append(f'{src} {key}={f[key]}')
      if (x%1)!=.5 or (y%1)!=.5: probs['anchor-not-pixel-center'].append(f'{src} {key}={f[key]}')
  px=list(im.getdata())
  alphas={p[3] for p in px}
  if alphas-{0,255}: probs['non-binary-alpha'].append(src)
  if not ('socket' in src):
    off={p[:3] for p in px if p[3] and p[:3] not in PAL}
    if off: probs['off-palette'].append(f'{src} {len(off)} colors e.g. {list(off)[:2]}')
  if not any(p[3] for p in px) and 'socket' not in src: probs['empty'].append(src)
  ps=f.get('productionSrc')
  if ps and os.path.exists(ps):
    big=Image.open(ps).convert('RGBA')
    if big.size!=(w*8,h*8): probs['8x-size'].append(ps)
    elif list(big.resize((w,h),Image.NEAREST).getdata())!=px or list(im.resize((w*8,h*8),Image.NEAREST).getdata())!=list(big.getdata()): probs['8x-not-exact'].append(ps)
  if f.get('pivot') and not os.path.exists(f['pivot']): probs['pivot-missing'].append(f['pivot'])
  hashes[hashlib.sha256(im.tobytes()).hexdigest()].append(src)
dups=[v for v in hashes.values() if len(v)>1 and any(p.startswith(('paw','arm','foot')) for p in v)]
for d in dups: probs['duplicate-pixels'].append(' == '.join(d))
# elbow pairs
E=json.load(open('joints/elbow.json'))['frames']
probs['elbow-disabled-count'].append(str(sum(1 for e in E if not e['allowedByBendLimit'])))
for e in E:
  for k in ('mask','patch'):
    if e.get(k) and os.path.exists(e[k]):
      im=Image.open(e[k]).convert('RGBA')
      if list(im.size)!=e['size']: probs['elbow-size'].append(e[k])
# angle coverage
for grp in ('paws',):
  for pose,d in m[grp].items():
    for v,l in d['views'].items():
      angs=sorted({f.get('angle', f.get('semantic',{}).get('nominalAngle')) for f in l})
      if len(angs)<8: probs['angle-gaps'].append(f'{grp}.{pose}.{v} {angs}')
print('png files', len([f for f in allf if f.endswith('.png')]), 'manifest png refs', len(refs))
for k,v in probs.items(): print(f'{k}: {len(v)}'); [print('   ',x) for x in v[:6]]
json.dump(probs,open(os.path.join(HERE,'asset-audit.json'),'w'),indent=1)
