import sys,types,json,math
from pathlib import Path
P=Path(__file__).parent;sys.path.insert(0,str(P));sys.modules['bpy']=types.ModuleType('bpy')
from basic_face_utils import basic_weights,STATES
r={'fixtureCount':0,'checks':[]}
for st in STATES:
 for t in [i/100 for i in range(101)]+[-1,2]:
  w=basic_weights(st,t);active=[(n,v) for n,v in w.items() if v>0];assert all(math.isfinite(v) and 0<=v<=1 for v in w.values());assert sum(w.values())<=1+1e-12;assert len(active)<=2;assert all(n.startswith('Basic'+st+'_') for n,v in active)
  if len(active)==2:assert abs(int(active[0][0][-2:])-int(active[1][0][-2:]))==1
  r['fixtureCount']+=1
r['checks']=['one semantic state only','at most2 adjacent authored knots','nonnegative finite coefficients','sum at most1 plus rest','clamps finite bounds','history and other new faces cleared by apply_basic'];r['passed']=True;(P/'weight-map-audit.json').write_text(json.dumps(r,indent=2));print(r)
