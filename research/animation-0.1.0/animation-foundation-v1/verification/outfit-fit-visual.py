"""Render a bounded candidate through the real demo before changing its fixture."""
import argparse,hashlib,json
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--fit',required=True);p.add_argument('--output',required=True);args=p.parse_args()
root=Path(__file__).resolve().parents[2];out=Path(args.output).resolve()
if out==root or root in out.parents:raise ValueError('External evidence required')
out.mkdir(parents=True,exist_ok=False)
fit_bytes=Path(args.fit).read_bytes();fit=json.loads(fit_bytes)
assert fit['status']=='completed'
source=(root/'animation-foundation-v1/configuration/fixtures/complete-outfit.mjs').read_text()
assert source.count('return outfit;')==1
candidate=source.replace('return outfit;', 'for(const mount of outfit.mounts)mount.offset='+json.dumps(fit['best']['offsets'])+'[mount.id];\n  return outfit;')
report={'status':'running','productionAccepted':False,'fitSHA256':hashlib.sha256(fit_bytes).hexdigest(),'originalModuleSHA256':hashlib.sha256(source.encode()).hexdigest(),'candidateModuleSHA256':hashlib.sha256(candidate.encode()).hexdigest(),'scope':'Real demo renderer; intercepted complete-outfit module changes only admitted offsets, never geometry','captures':[],'errors':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  for variant in ['baseline','candidate']:
   page=browser.new_page(viewport={'width':1100,'height':900},device_scale_factor=1)
   page.on('pageerror',lambda error:report['errors'].append(str(error)))
   if variant=='candidate':page.route('**/configuration/fixtures/complete-outfit.mjs',lambda route:route.fulfill(status=200,content_type='text/javascript',body=candidate))
   page.goto('http://127.0.0.1:8766/animation-foundation-v1/demo/index.html?capture=1',wait_until='networkidle',timeout=120000)
   page.wait_for_function("document.documentElement.dataset.ready==='true'",timeout=120000)
   def call(name,*values):return page.evaluate('async([name,args])=>(await import("./app.mjs"))[name](...args)',[name,values])
   assert call('select','wardrobe')
   for phase in ['idle','drag','landing']:
    if phase=='drag':
     call('view',0);call('advance',0);point=call('point');call('inputTime');page.mouse.move(point['x'],point['y']);page.mouse.down()
     for i in range(60):
      call('inputTime');page.mouse.move(point['x']+i*.6,point['y']-i*.45);call('advance',1/60)
    elif phase=='landing':
     call('inputTime');page.mouse.up()
     for i in range(10):call('advance',1/60)
    for angle in [0,60,-60]:
     call('view',angle);state=call('advance',0)
     assert not state['errors'],state
     assert state['state']['mode']==phase,state
     name=f'{variant}-{phase}-{angle}.png'
     page.locator('canvas').screenshot(path=str(out/name))
     report['captures'].append({'file':name,'variant':variant,'phase':phase,'angle':angle,'state':state})
   call('dispose');page.close()
  browser.close()
 assert not report['errors'],report['errors']
 report['status']='rendered';report['visualReview']='pending'
except Exception as error:report['status']='failed';report['failure']=str(error);raise
finally:(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
