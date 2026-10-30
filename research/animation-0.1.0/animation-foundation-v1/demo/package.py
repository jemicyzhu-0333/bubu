"""Package verified local browser dependencies and their licenses; no network fetch."""
import argparse, hashlib, json, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--report',required=True);p.add_argument('--output',required=True);a=p.parse_args()
report=json.loads(Path(a.report).read_text());assert report['status']=='passed'
output=Path(a.output).resolve()
if output.exists() or output==ROOT or ROOT in output.parents:raise ValueError('New external ZIP required')
files={}
for name,expected in report['fetchedFiles'].items():
 path=(ROOT/name).resolve()
 if ROOT not in path.parents:raise ValueError('External package dependency')
 data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==expected,name
 files['site/'+name]=data
for package in ['three','three-mesh-bvh','@pixiv/three-vrm-springbone','@dimforge/rapier3d-compat']:
 for path in (ROOT/'node_modules'/package).glob('*'):
  if path.is_file() and any(word in path.name.upper() for word in ['LICENSE','NOTICE']):files['site/'+str(path.relative_to(ROOT))]=path.read_bytes()
for path in ROOT.rglob('*'):
 if 'node_modules' not in path.parts and path.is_file() and any(word in path.name.upper() for word in ['LICENSE','NOTICE','USAGE']):
  files['site/'+str(path.relative_to(ROOT))]=path.read_bytes()
for name in ['LICENSE','LICENSE.md','LICENSE.txt']:
 path=ROOT.parents[1]/name
 if path.is_file():files[name]=path.read_bytes()
files['run-demo.py']='''from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
import webbrowser
root=Path(__file__).resolve().parent/'site'
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(root)))
url=f'http://127.0.0.1:{server.server_port}/animation-foundation-v1/demo/'
print(url,flush=True)
webbrowser.open(url)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
'''.encode()
files['使用说明.txt']='''小步 V2 动画演示
解压后运行：python3 run-demo.py （Windows 可使用 python run-demo.py）
保持终端开启，在现代 Chrome / Edge 浏览器查看。首次运行不需要下载 npm 依赖。
包含原始部件、鼠标抚摸/拖动/落地、18 种表情、五组配件、完整穿搭、配件回应、书本简化刚体释放和独立喝茶回放。
正面/侧面/背面、深浅背景、暂停与减少动效均可切换。
喝茶没有获得穿搭兼容准入；披风为既有摆动方案，不是已通过验收的实时布料。
视频按 24 fps 逐帧采样实际浏览器画面，不代表真实设备运行帧率。
此包是研究演示，不是生产安装包，不修改应用数据。素材许可与角色权利仍以附带原始声明为准。
'''.encode()
files['demo-report.json']=Path(a.report).read_bytes()
manifest={name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}
files['SHA256SUMS.json']=(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()
output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
 for name,data in files.items():archive.writestr(name,data)
print(json.dumps({'file':str(output),'files':len(files),'bytes':output.stat().st_size}))
