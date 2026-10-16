from pathlib import Path
import math,json
from closed_mouth_transition import close_then_shape
P=Path(__file__).parent
# Analytic rounded capsule for independent tests; actual shapes use the exact
# authored sampled capsule boundary and are checked in the exported geometry.
def pill(u,v):
 lo,hi=0.,.2
 for _ in range(50):
  r=(lo+hi)/2;x=r*u;z=r*v
  if math.hypot(max(0,abs(x)-.038),z)<=.023:lo=r
  else:hi=r
 return lo*u,.695+lo*v
N=128;angles=[2*math.pi*i/N for i in range(N)];cases=0;maxspread=0.;maxendpoint=0.;maxinner_error=0.
for family in ['slant','smile']:
 for t in [i/100 for i in range(101)]:
  inner=[]
  for a in angles:
   u,v=math.cos(a),math.sin(a)
   # Every legal filled stroke collapses its rr0 boundary to one authored
   # interior anchor. Test different destinations to cover translation too.
   end=(0,.707 if family=='slant' else .776)
   p=close_then_shape(0,u,v,t,end,pill(u,v));inner.append(p)
   if t<=.5:
    q=t/.5;k=q*q*(3-2*q);expect=.026*(1-k);maxinner_error=max(maxinner_error,abs(math.hypot(p[0],p[1]-.695)-expect))
   else:maxspread=max(maxspread,math.dist(p,inner[0]))
   cases+=1
 for a in angles:
  u,v=math.cos(a),math.sin(a)
  for rr in [0,.25,.5,.75,1]:
   end=(rr*.08*u,.707+rr*.025*v)
   got=close_then_shape(rr,u,v,1,end,pill(u,v));maxendpoint=max(maxendpoint,math.dist(got,end));cases+=1
assert maxspread<1e-12 and maxendpoint==0 and maxinner_error<1e-12
r={'cases':cases,'allClosedInnerPointsCoincidentAfterHalf':maxspread,'maxEndpointDifference':maxendpoint,'maxSymmetricInnerRadiusErrorBeforeHalf':maxinner_error,'passed':True,'scope':'primitive chart invariants; real eye/mouth/body attachment, topology and visual paths tested separately','requiredKnot':.5,'unsupported':'direct open-ring-to-bent-line blend; non-injective endpoint parameterization; multi-face superposition'}
(P/'closed-mouth-primitive-audit.json').write_text(json.dumps(r,indent=2));print(r)
