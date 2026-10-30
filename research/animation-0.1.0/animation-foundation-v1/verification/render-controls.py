"""Separate RAF, drawing, geometry subsets and synchronous readback costs."""
import argparse,hashlib,json
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
root=Path(__file__).resolve().parents[2];out=Path(args.output).resolve()
if out==root or root in out.parents:raise ValueError('External output required')
out.mkdir(parents=True,exist_ok=False)
report={'status':'running','productionAccepted':False,'scope':'Diagnostic rendering controls; hidden geometry is never a proposed quality reduction','rows':[],'errors':[],'limitations':['Software SwiftShader only.','Client submission is not GPU duration.','Draw plus 1-pixel synchronous readback includes driver, draw and copy costs; it is not GPU-only time.']};fetched=set()
def save():
 report['sourceHashes']={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sorted(fetched)}
 report['verifierSHA256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=browser.new_page(viewport={'width':600,'height':600});page.on('pageerror',lambda e:report['errors'].append(str(e)))
  def response(r):
   if urlparse(r.url).netloc!='127.0.0.1:8766':return
   name=unquote(urlparse(r.url).path).lstrip('/')
   if r.status>=400:report['errors'].append(f'{r.status}: {name}')
   if (root/name).is_file():fetched.add(name)
  page.on('response',response)
  page.goto('http://127.0.0.1:8766/animation-foundation-v1/verification/face-render-probe.html',wait_until='networkidle',timeout=120000)
  page.wait_for_function("document.documentElement.dataset.ready==='true'",timeout=120000)
  def call(name,*values):return page.evaluate('async([name,args])=>(await import("./face-render-probe.mjs"))[name](...args)',[name,values])
  report['initial']=call('status')
  controls=['raf-only','empty','body-only','faces-only','static-neutral','static-face','animated-face','sparse-face']
  for round,order in enumerate([controls,list(reversed(controls))]):
   for name in order:
    row=call('control',name,40);row['round']=round;report['rows'].append(row);save();print(json.dumps(row),flush=True)
    assert row['glError']==0,row
  report['final']=call('status');assert not report['errors'] and not report['final']['errors'],report
  call('dispose');browser.close();report['status']='passed'
except Exception as error:report['status']='failed';report['failure']=str(error);raise
finally:save()
