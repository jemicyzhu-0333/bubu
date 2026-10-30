from playwright.sync_api import sync_playwright
from pathlib import Path
import json,hashlib
out=Path('/workspace/artifacts/bubu-v2-demo-20261024');rows=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':1100,'height':900})
 page.goto('http://127.0.0.1:8766/animation-foundation-v1/demo/?capture',wait_until='networkidle',timeout=120000)
 page.wait_for_function("document.documentElement.dataset.ready==='true'")
 def call(name,*args):return page.evaluate('async ([n,a])=>(await import("./app.mjs"))[n](...a)',[name,args])
 for at in [2.25,8.75]:
  call('select','tea')
  for _ in range(round(at/.25)):call('advance',.25)
  call('cancel');call('advance',.05);call('cancel')
  for _ in range(12):call('advance',.25)
  assert call('snapshot')['state']['phase']=='rest'
  call('cancel')
  for _ in range(8):s=call('advance',.25)
  assert s['state']['phase']=='rest';assert not s['errors']
  rows.append({'cancelAt':at,'repeatDuringCancellation':True,'repeatAfterCompletion':True,'snapshot':s})
 page.screenshot(path=str(out/'tea-repeated-cancel.png'))
 call('dispose');b.close()
hashes=json.loads(Path('/tmp/bubu-tea-followup-hashes.json').read_text())
report={'status':'passed','scope':'Repeated tea cancellation during and after completion, including crossing the loop seam','cases':rows,'source':hashes,'scriptSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
(out/'tea-followup.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('repeated cancel passed',len(rows),'cases')
