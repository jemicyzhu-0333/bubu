import json,math
from pathlib import Path
import argparse,sys
parser=argparse.ArgumentParser();parser.add_argument('--cache-root',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
root=args.cache_root.resolve()/'play-props'
source_root=Path(__file__).resolve().parents[1];out=[]
for p in sorted((root/'reports').glob('*-mounted.json'))+sorted((root/'reports').glob('*-repeated.json')):
 d=json.loads(p.read_text());pts=[m['positions'][i:i+3] for m in d['frames'][0]['meshes'] for i in range(0,len(m['positions']),3)];views=[]
 for angle in [0,45,90,180]:
  a=math.radians(angle);xy=[((x*math.cos(a)-z*math.sin(a))/5.264+.5,.5-(y-1.5)/5.264) for x,y,z in pts];views.append({'angle':angle,'normalizedBounds':[min(v[0] for v in xy),min(v[1] for v in xy),max(v[0] for v in xy),max(v[1] for v in xy)],'outOfFrameVertices':sum(not(0<=x<=1 and 0<=y<=1) for x,y in xy)})
 out.append({'file':p.name,'views':views,'pass':all(v['outOfFrameVertices']==0 for v in views)})
result={'camera':'fixed orthographic span 5.264, target [0,1.5,0], no auto-fit','cssStage':219,'bodyDesignWidthCss':2.3797432184/5.264*219,'items':out};(root/'reports/stage-audit.json').write_text(json.dumps(result,indent=2));assert all(i['pass'] for i in out)
