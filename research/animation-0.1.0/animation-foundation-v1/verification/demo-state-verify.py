"""Real browser regressions for demo expression projection and render suspension."""
import argparse,hashlib,json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
out=Path(args.output).resolve();root=Path(__file__).resolve().parents[2]
if out==root or root in out.parents:raise ValueError('External output required')
out.mkdir(parents=True,exist_ok=False)
report={'status':'running','productionAccepted':False,'errors':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=browser.new_page(viewport={'width':1100,'height':900});page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.goto('http://127.0.0.1:8766/animation-foundation-v1/demo/?capture',wait_until='networkidle',timeout=120000)
  page.wait_for_function("document.documentElement.dataset.ready==='true'",timeout=120000)
  def call(name,*values):return page.evaluate('async ([name,args])=>(await import("./app.mjs"))[name](...args)',[name,values])
  def frames(n=20):
   for i in range(n):state=call('advance',1/24)
   return state
  call('face','N3');assert frames()['state']['face']['owner']=='authored'
  call('select','wardrobe');state=frames();report['afterSceneChange']=state
  assert state['state']['face']['owner']!='authored',state['state']['face']
  assert page.locator('#face').input_value()==''
  call('pause',True);start=frames(1);end=frames(30)
  assert end['time']==start['time'] and end['renderedFrames']==start['renderedFrames']
  report['pausedFramesSkipped']=30
  call('view',45);drawn=frames(1);assert drawn['renderedFrames']==end['renderedFrames']+1
  assert frames(10)['renderedFrames']==drawn['renderedFrames']
  call('face','N3');assert page.locator('#face').is_disabled()
  call('select','tea');call('select','wardrobe');call('inputTime');point=call('point')
  page.mouse.move(point['x'],point['y']);page.mouse.down();frames(5)
  call('pause',False);state=frames(20);assert state['state']['mode']=='idle' and state['state']['pointerId'] is None,state
  call('inputTime');page.mouse.up();frames(2);report['pausedSceneInputSuppressed']=True
  call('face','N3');assert frames()['state']['face']['owner']=='authored'
  call('reduce',True);state=frames(2);assert page.locator('#face').is_disabled() and page.locator('#face').input_value()==''
  call('reduce',False);assert frames()['state']['face']['owner']!='authored';report['reducedClearsAuthored']=True
  call('face','N3');frames();call('cancel');state=frames();assert page.locator('#face').input_value()=='' and state['state']['face']['owner']!='authored'
  report['cancelClearsAuthored']=True;report['graphics']=call('graphics');assert not state['errors'] and not report['errors']
  report['teaCancellationEndpoints']=[]
  for cancel_at in [1.3,1.7,4.1,6.8]:
   call('select','tea');elapsed=0
   while elapsed<cancel_at:
    dt=min(.25,cancel_at-elapsed);call('advance',dt);elapsed+=dt
   call('cancel');state=call('advance',.18);assert not state['errors'] and not report['errors'],state
   state=frames(30);assert state['state']['phase']=='rest',state
   report['teaCancellationEndpoints'].append(cancel_at)
  call('dispose');browser.close();report['status']='passed'
except Exception as error:
 report['status']='failed';report['failure']=str(error);raise
finally:
 report['sourceHashes']={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['animation-foundation-v1/demo/app.mjs','animation-foundation-v1/demo/tea-preview.mjs','animation-foundation-v1/integration/tea-sample-boundary.mjs','animation-foundation-v1/verification/demo-state-verify.py']}
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
