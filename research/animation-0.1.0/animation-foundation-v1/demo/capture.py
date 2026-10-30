"""Verify actual V2 browser composition; optionally encode explicitly sampled frames."""
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'verification'))
from json_evidence import encode_evidence
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--url',default='http://127.0.0.1:8766/animation-foundation-v1/demo/');p.add_argument('--browser',default='/usr/bin/chromium');p.add_argument('--record',action='store_true');args=p.parse_args()
out=Path(args.output).resolve()
if out==ROOT or ROOT in out.parents:raise ValueError('Output must be outside research sources')
out.mkdir(parents=True,exist_ok=False)
report={'status':'running','scope':'Real Chromium WebGL and DOM input, shared FoundationActor with original parts/accessories; isolated tea replay and synthetic book collision','sampleClockFPS':24,'realtimeFPSClaim':False,'productionAccepted':False,'chapters':[],'errors':[],'captureScriptSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'dprChecks':[]}
encoder=None;frames_written=0;fetched=set();started=time.monotonic()
def save():
 report['frames']=frames_written;report['elapsedSeconds']=time.monotonic()-started
 report['fetchedFiles']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sorted(fetched)}
 (out/'demo-report.json').write_text(encode_evidence(report)+'\n')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=args.browser,headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=browser.new_page(viewport={'width':1100,'height':900},device_scale_factor=1)
  page.on('pageerror',lambda error:report['errors'].append(str(error)))
  def response(res):
   parsed=urlparse(res.url)
   if parsed.netloc==urlparse(args.url).netloc:
    path=unquote(parsed.path).lstrip('/'); path=path+'index.html' if path.endswith('/') else path
    if res.status>=400:report['errors'].append(f'HTTP {res.status}: {path}')
    if (ROOT/path).is_file():fetched.add(path)
  page.on('response',response)
  page.goto(args.url+'?capture',wait_until='networkidle',timeout=120000)
  page.wait_for_function("document.documentElement.dataset.ready==='true'",timeout=120000)
  def call(name,*values):return page.evaluate('async ([name,args]) => (await import("./app.mjs"))[name](...args)',[name,values])
  report['graphics']=call('graphics')
  if args.record:
   encoder=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate','24','-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'bubu-v2-demo.mp4')],stdin=subprocess.PIPE)
  def frame():
   global frames_written
   state=call('advance',1/24)
   assert not state['errors'],state['errors']
   if encoder:encoder.stdin.write(page.screenshot(type='png'))
   frames_written+=1
   return state
  def frames(n):
   for _ in range(n):state=frame()
   return state
  def chapter(id,title=None,description=None):
   if id in ['bare','ear','satchel','cape','book','halo','wardrobe','tea']:assert call('select',id)
   if title:call('caption',title,description or '')
   row={'id':id,'firstFrame':frames_written,'timeSeconds':frames_written/24};report['chapters'].append(row)
   print('chapter',id,'frame',frames_written,flush=True);save()
  def shot(name):page.screenshot(path=str(out/(name+'.png')))
  chapter('bare');frames(36);shot('idle')
  chapter('petting','轻轻摸摸','真实鼠标按住身体，进入持续抚摸。')
  pt=call('point');call('inputTime');page.mouse.move(pt['x'],pt['y']);page.mouse.down()
  state=frames(36);assert state['state']['mode']=='petting',state['state']['mode'];shot('petting')
  call('inputTime');page.mouse.up();frames(24)
  chapter('drag','提起，再轻轻放下','连续拖动、惯性摆动与落地恢复。')
  pt=call('point');call('inputTime');page.mouse.move(pt['x'],pt['y']);page.mouse.down()
  for i in range(36):
   call('inputTime');page.mouse.move(pt['x']+60*(i+1)/36,pt['y']-55*(i+1)/36);state=frame()
  assert state['state']['mode']=='drag';shot('drag')
  call('inputTime');page.mouse.up();state=frames(60);assert state['state']['mode']=='idle'
  chapter('expressions','18 种表情','沿同一表情所有者连续切换。')
  expressions=page.locator('#face option').evaluate_all('(options)=>options.slice(1).map(o=>({id:o.value,label:o.textContent}))')
  for expression in expressions:
   call('caption','表情 · '+expression['id'],expression['label']);call('face',expression['id']);state=frames(18)
   assert state['state']['face']['path']==expression['id']
  report['expressions']=[e['id'] for e in expressions];assert len(expressions)==18
  call('face','');frames(8)
  for name in ['ear','satchel','cape','halo','book']:
   chapter(name);call('view',150 if name=='cape' else 0);frames(6);call('greet');state=frames(48);shot(name)
   if name=='book':assert state['book']['released'],'Book did not transfer to physics'
  chapter('wardrobe');call('view',0);state=frames(36);assert len(state['mounts'])==5;shot('poster')
  assert state['pool']['emitters'][0]['activeEmitters']==4,state['pool']['emitters']
  pt=call('point');call('inputTime');page.mouse.move(pt['x'],pt['y']);page.mouse.down();call('inputTime');page.mouse.move(pt['x']+50,pt['y']-35)
  state=frames(18);assert state['state']['mode']=='drag';call('inputTime');page.mouse.up();frames(48)
  chapter('tea');call('view',0)
  for i in range(216):
   frame()
   if i==88:shot('tea-sip')
  call('cancel');frames(30);assert call('snapshot')['state']['phase']=='rest'
  chapter('wardrobe','完整穿搭 · 深色背景','同一角色与配件，检查深色背景下的轮廓。')
  page.locator('#theme').click();frames(36);shot('dark');page.locator('#theme').click()
  report['videoFrames']=frames_written
  if encoder:
   encoder.stdin.close();assert encoder.wait(timeout=60)==0;encoder=None
  call('pause',True);before=call('snapshot')['time'];frames(3);assert call('snapshot')['time']==before;call('pause',False)
  call('reduce',True);frames(4);call('reduce',False)
  # Repeated real actor teardown/recreate with the same renderer, no forced GC.
  def warmed_baseline():
   call('select','wardrobe')
   for _ in range(3):call('advance',.1)
   call('select','bare');frames(2)
   return call('snapshot')
  baseline=warmed_baseline()['resources'];report['resourceCycles']=[]
  for _ in range(2):
   call('select','tea')
   # Cross a loop seam after cancellation; the cup must stay retired.
   for i in range(35):call('advance',.25)
   call('cancel');call('advance',.05);call('cancel')
   for i in range(10):call('advance',.25)
   assert call('snapshot')['state']['phase']=='rest'
   call('cancel');call('advance',.25)
   assert call('snapshot')['state']['phase']=='rest'
   call('reduce',True);call('advance',.1);call('reduce',False)
   for i in range(10):call('advance',.25)
   assert call('snapshot')['state']['phase']=='rest'
   state=warmed_baseline();report['resourceCycles'].append(state['resources'])
   assert state['resources']==baseline,(baseline,state['resources'])
  call('contextLoss');page.wait_for_function("document.querySelector('canvas').getContext('webgl2').isContextLost()")
  call('contextRestore');page.wait_for_function("!document.querySelector('canvas').getContext('webgl2').isContextLost()")
  call('pause',False);frames(2);assert call('graphics')['error']==0
  report['final']=call('snapshot');assert not report['final']['errors'];assert not report['errors']
  call('dispose');awaitless=call('snapshot');report['disposedPool']=awaitless['pool'];assert awaitless['pool']['budget']['claimedBytes']==0
  page.close()
  if encoder:
   encoder.stdin.close();assert encoder.wait(timeout=60)==0;encoder=None
  for dpr in [1.25,2]:
   context=browser.new_context(viewport={'width':1100,'height':900},device_scale_factor=dpr)
   page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.on('response',response)
   page.goto(args.url+'?capture',wait_until='networkidle',timeout=120000)
   page.wait_for_function("document.documentElement.dataset.ready==='true'",timeout=120000)
   call('select','wardrobe');state=call('advance',.05);assert len(state['mounts'])==5
   shot('wardrobe-dpr-'+str(dpr));report['dprChecks'].append({'dpr':dpr,'snapshot':state})
   call('dispose');context.close()
  browser.close()
 assert not report['errors'],report['errors']
 report['fetchedFiles']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sorted(fetched)}
 report['status']='passed';save();print('passed',frames_written,'frames',flush=True)
except Exception as error:
 report['status']='failed';report['failure']=str(error);save();raise
finally:
 if encoder:
  encoder.stdin.close();encoder.wait(timeout=60)
