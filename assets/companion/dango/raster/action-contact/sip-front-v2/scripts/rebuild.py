#!/usr/bin/env python3
"""Rebuild one frozen sip source; writes only to a new output directory."""
from pathlib import Path
from PIL import Image
import argparse, hashlib, json, math, subprocess
import numpy as np

PKG=Path(__file__).resolve().parents[1]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--repo-root',type=Path);args=parser.parse_args()
if args.output.exists():raise SystemExit('Output must be a new directory; existing files are never overwritten.')
args.output.mkdir(parents=True)
frames=json.loads((PKG/'frames.json').read_text());assert frames['runtimeReady'] is False and frames['hostAcceptance'] is None
assert len(frames['frames'])==4 and all(f['size']==[66,72] and f['rect']==[0,0,66,72] for f in frames['frames'])
recipe=json.loads((PKG/'sources/extraction/extraction-recipe.json').read_text())
master=PKG/'sources/masters/complete-sip-forepalm-v1.png'
assert sha(master)==recipe['sourceSha256']
source=Image.open(master).convert('RGBA');f=recipe['frames'][0];crop=source.crop(f['cropBox'])
stored=Image.open(PKG/'sources/extraction'/f['sourceRgba']).convert('RGBA')
assert np.array_equal(np.array(crop),np.array(stored)), 'Raw extraction drift'
backMask=np.array(Image.open(PKG/'sources/extraction/upper-arm-root-back-depth-mask.png'))
frontMask=np.array(Image.open(PKG/'sources/extraction/upper-arm-fore-palm-front-depth-mask.png'))
assert np.all(backMask.astype(int)+frontMask.astype(int)==255),'Depth masks must retain exact source union'
for key in ['back','front']:assert sha(PKG/'sources/extraction'/recipe['runtimeDepth'][key+'Mask'])==recipe['runtimeDepth'][key+'MaskSha256']
expectedBack=np.zeros_like(backMask);expectedBack[:frames['sourceDepthY']-f['cropBox'][1],:]=255
assert np.array_equal(backMask,expectedBack),'Declared source depth boundary changed'
repo=args.repo_root
if repo is None:
    repo=next((p for p in PKG.parents if (p/'package.json').exists() and (p/'assets/companion/dango/raster').exists()),None)
if repo is None:raise SystemExit('--repo-root is required when the package is outside the repository.')
decoded=args.output/'source-canvas-readback.rgba'
subprocess.run(['node',str(PKG/'scripts/read_pixels.mjs'),str(repo),str(PKG/'sources/extraction'/f['sourceRgba']),str(decoded)],check=True)
raw=np.frombuffer(decoded.read_bytes(),dtype=np.uint8).reshape((crop.height,crop.width,4))
palette=np.array(frames['sourcePalette']);scale=frames['scaleArtPerSourcePixel']
contact=[frames['sourceContact'][k]-f['cropBox'][k] for k in range(2)]
results=[]
for side in ['left','right']:
    mirror=side=='right'; target=[40.25 if mirror else 24.25,53.375]
    cx=crop.width-contact[0] if mirror else contact[0]
    translation=[target[0]-cx*scale,target[1]-contact[1]*scale]
    buffers={name:np.zeros((72,66,4),np.uint8) for name in ['root-back','fore-palm-front']}
    for y in range(72):
        for x in range(66):
            rx=math.floor((x+.5-translation[0])/scale);sy=math.floor((y+.5-translation[1])/scale)
            sx=crop.width-1-rx if mirror else rx
            if sx<0 or sy<0 or sx>=crop.width or sy>=crop.height or raw[sy,sx,3]<240:continue
            distances=((palette.astype(int)-raw[sy,sx,:3].astype(int))**2).sum(axis=1)
            color=palette[int(distances.argmin())]
            layer='root-back' if backMask[sy,sx] else 'fore-palm-front'
            buffers[layer][y,x]=[*color,255]
    for layer,buf in buffers.items():
        name=f'sip-front-v2-{side}-{layer}';im=Image.fromarray(buf)
        for suffix,size in [('',(66,72)),('-8x',(528,576))]:
            dest=args.output/(name+suffix+'.png');img=im if suffix=='' else im.resize(size,Image.Resampling.NEAREST);img.save(dest)
            original=PKG/dest.name
            pixelsEqual=np.array_equal(np.array(img),np.array(Image.open(original).convert('RGBA')))
            assert pixelsEqual,f'Fixed source projection mismatch: {dest.name}'
            results.append({'file':dest.name,'pixelsEqual':pixelsEqual,'pngBytesEqual':sha(dest)==sha(original),'sha256':sha(dest)})
if args.repo_root:
    refs=json.loads((PKG/'sources/provenance/resolved-references.json').read_text())['references']
    for ref in refs:assert sha(args.repo_root/ref['repoPath'])==ref['sha256'],f'Reference drift: {ref["repoPath"]}'
report={'runtimeReady':False,'hostAcceptance':None,'sourceRgbaPreserved':True,'depthExactPartition':True,'frames':results}
(args.output/'rebuild-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
