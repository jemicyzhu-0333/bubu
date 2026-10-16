import math,json
from pathlib import Path
from round_stroke_geometry import swept_capsule
P=Path(__file__).parent
R={}
for name,args in {'A7':(.183,.025,-.093,.00706519455164431),'S2':(.126,.0255,.642,.7439898664237167)}.items():
 w,r,z0,z1=args
 pts=[swept_capsule(math.cos(t*math.tau/10000),math.sin(t*math.tau/10000),*args) for t in range(10001)]
 bb=[min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)]
 target=[-w,z0,w,z1]
 maxerr=max(abs(a-b) for a,b in zip(bb,target))
 depth=z1-z0-2*r;maxCurvature=2*depth/(w-r)**2
 # Curved offset strips are injective while radius*curvature < 1.
 assert maxerr<2e-6 and r*maxCurvature<1
 R[name]={'sampledBounds':bb,'lockedBounds':target,'maxBoundError':maxerr,'radiusTimesMaxCurvature':r*maxCurvature,'roundCaps':True,'strokeMeasuredAlong':'centreline normal, not vertical chart axis'}
(P/'round-stroke-geometry-audit.json').write_text(json.dumps(R,indent=2));print(R)
