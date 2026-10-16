from pathlib import Path
import math,json
from closed_mouth_boundary import rounded_pill_boundary
from closed_mouth_transition import close_then_shape
from round_stroke_geometry import swept_capsule
rows=[];oldErrors=[]
for i in range(1024):
 a=i*math.tau/1024;u,v=math.cos(a),math.sin(a);x,z=rounded_pill_boundary(u,v);radial=abs(x*v-(z-.695)*u);dist=math.hypot(x-max(-.038,min(.038,x)),z-.695);nx,nz=close_then_shape(1,u,v,.5,(0,.695),(x,z));outdist=math.hypot(nx-max(-.038,min(.038,nx)),nz-.695)
 assert radial<1e-13 and abs(dist-.023)<1e-13 and abs(outdist-.023)<1e-13
 rows.append((radial,abs(dist-.023),abs(outdist-.023)))
 bx,bz=swept_capsule(u,v,.061,.023,.672,.718);xx,zz=close_then_shape(1,u,v,.5,(0,.695),(bx,bz));oldErrors.append(abs(math.hypot(xx-max(-.038,min(.038,xx)),zz-.695)-.023))
r={'samples':len(rows),'passed':True,'maxCollinearityError':max(x[0] for x in rows),'maxBoundaryDistanceError':max(x[1] for x in rows),'maxClosureContourError':max(x[2] for x in rows),'rejectedNonRadialSweepInputMaxContourError':max(oldErrors),'scope':'Pure chart geometry; actual four-view rendered interpolation remains a separate gate.'};Path(__file__).with_name('closed-mouth-boundary-audit.json').write_text(json.dumps(r,indent=2));print(r)
