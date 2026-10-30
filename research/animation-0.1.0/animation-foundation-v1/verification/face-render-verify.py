"""Compare exact reference/sparse WebGL pixels and completed-frame timings."""
import argparse,hashlib,json,time
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--url',default='http://127.0.0.1:8766/animation-foundation-v1/verification/face-render-probe.html');args=p.parse_args()
root=Path(__file__).resolve().parents[2];out=Path(args.output).resolve()
if out==root or root in out.parents:raise ValueError('External evidence directory required')
out.mkdir(parents=True,exist_ok=False)
report={'status':'running','softwareRendering':True,'nativeGPUAccepted':False,'productionAccepted':False,'samples':[],'timing':[],'errors':[]};fetched=set()
def save():
 report['sourceHashes']={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sorted(fetched)}
 report['verifierSHA256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=browser.new_page(viewport={'width':600,'height':600})
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  def response(r):
   if urlparse(r.url).netloc!=urlparse(args.url).netloc:return
   name=unquote(urlparse(r.url).path).lstrip('/')
   if r.status>=400:report['errors'].append(f'{r.status}: {name}')
   if (root/name).is_file():fetched.add(name)
  page.on('response',response)
  page.goto(args.url,wait_until='networkidle',timeout=120000)
  page.wait_for_function("document.documentElement.dataset.ready==='true'",timeout=120000)
  def call(name,*values):return page.evaluate('async ([name,args])=>(await import("./face-render-probe.mjs"))[name](...args)',[name,values])
  report['initial']=call('status');assert not report['initial']['errors'],report['initial']
  for path in report['initial']['paths']:
   for angle in [0,45]:
    for index in range(17):report['samples'].append(call('sample',path,index/16,angle))
   print('parity',path,flush=True);save()
  report['differentSamples']=[s for s in report['samples'] if s['different']]
  assert not report['differentSamples'],report['differentSamples'][:3]
  for mode in [0,1,1,0]:
   row=call('timing',mode,90);report['timing'].append(row);print('timing',row,flush=True);save()
  report['final']=call('status');assert not report['errors'] and not report['final']['errors'],report
  page.screenshot(path=str(out/'actual-render.png'))
  report['status']='passed';call('dispose');browser.close()
except Exception as error:
 report['status']='failed';report['failure']=str(error);raise
finally:save()
