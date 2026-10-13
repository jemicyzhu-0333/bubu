"""Candidate source integrity check; never grants visual or runtime acceptance."""
from pathlib import Path
from PIL import Image
import argparse,hashlib,json,subprocess,tempfile
P=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--repo-root',type=Path);p.add_argument('--rebuild',action='store_true');p.add_argument('--report',type=Path);args=p.parse_args()
R=args.repo_root.resolve() if args.repo_root else next((d for d in P.parents if (d/'package.json').is_file() and (d/'assets/companion/dango/raster').is_dir()),None)
assert R,'Supply --repo-root'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
D=json.loads((P/'sources/resolved-provenance.json').read_text())
for f in D['preservedInputs']:assert sha(P/f['packagePath'])==f['sha256'],f
for f in D['generationReferences']+[D['canonicalBody']]+D['metadataPathResolution']:assert sha(R/f['repoPath'])==f['sha256'],f
manifest=json.loads((P/'frames.json').read_text());assert manifest['runtimeReady'] is False
recipe=json.loads((P/'sources/extraction/extraction-recipe.json').read_text());master=Image.open(P/'sources/masters/low-cup-continuous-v2.png').convert('RGBA')
checks=[]
for f in recipe['frames']:
 side=f['side'];im=Image.open(P/'sources/extraction'/f['sourceRgba']).convert('RGBA');mask=Image.open(P/'sources/extraction'/f'{side}-geometric-mask.png').convert('L');orig=master.crop(f['cropBox'])
 assert all(a[:3]==b[:3] and a[3]==b[3]*m//255 for a,b,m in zip(im.getdata(),orig.getdata(),mask.getdata()))
 small=Image.open(P/f'{side}-logical.png').convert('RGBA');big=Image.open(P/f'{side}-8x.png').convert('RGBA');assert small.size==(66,72);assert big.tobytes()==small.resize((528,576),Image.Resampling.NEAREST).tobytes()
 assert set(small.getchannel('A').getdata())<={0,255};colors={px[:3]for px in small.getdata()if px[3]};assert colors<=set(map(tuple,manifest['palette']))
 checks.append({'side':side,'sourceRgbAndMultipliedAlphaExact':True,'logicalSize':[66,72],'binaryAlpha':True,'paletteColors':len(colors),'exact8x':True})
files=json.loads((P/'FILES.sha256.json').read_text());actual={str(f.relative_to(P)) for f in P.rglob('*') if f.is_file() and f.name!='FILES.sha256.json'};assert actual==set(files),'file list differs'
for rel,h in files.items():assert sha(P/rel)==h,rel
rebuild=None
if args.rebuild:
 with tempfile.TemporaryDirectory(prefix='sip-source-rebuild-') as tmp:
  T=Path(tmp);E=T/'sources/extraction'
  subprocess.run(['python',str(P/'scripts/rebuild_source.py'),'--output',str(E)],check=True,capture_output=True)
  subprocess.run(['node',str(P/'scripts/build_pose.mjs'),'--repo-root',str(R),'--source-root',str(E),'--output',str(T)],check=True,capture_output=True)
  pngs=[f'sources/extraction/{side}-{name}.png' for side in ['left','right'] for name in ['source-rgba','geometric-mask']]+[f'{side}-{name}.png'for side in ['left','right']for name in ['logical','8x']]
  for rel in pngs:
   a,b=Image.open(P/rel),Image.open(T/rel);assert a.mode==b.mode and a.size==b.size and a.tobytes()==b.tobytes(),rel
  a=json.loads((P/'sources/extraction/extraction-recipe.json').read_text());b=json.loads((E/'extraction-recipe.json').read_text());a.pop('source');b.pop('source');assert a==b
  assert (P/'sources/extraction/verification.json').read_bytes()==(E/'verification.json').read_bytes()
  assert (P/'frames.json').read_bytes()==(T/'frames.json').read_bytes()
  rebuild={'isolatedTemporaryDirectory':True,'rawExtractionAndLogicalAndExact8xPixelsEquivalent':True,'recipeEquivalentExceptPortableSourcePath':True,'framesByteEquivalent':True,'verificationByteEquivalent':True}
guard=subprocess.run(['python',str(P/'scripts/source_integrity_guard.py')],check=True,capture_output=True,text=True)
assert json.loads(guard.stdout)['allTestsPass'] is True
report={'sourceIntegrityGuardExpectedOutcomesVerified':True,'runtimeReady':False,'status':'source-integrity check only; independent visual and runtime gates remain pending','filesAndDependencyHashesVerified':True,'sides':checks,'rebuild':rebuild}
if args.report:args.report.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
