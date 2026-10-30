import * as T from 'three';

/** Analytic speed bounds per unit handEntry/lift, for the hash-pinned rigid-tea
 * formulas. These bound every point of each triangle, not frame interpolation.
 * The caller must check controller/input identities and the branch joins. */
export function teaHandMotionBounds({config,hold,sip},name,positions,{forwardOffset=0}={}) {
  const h=config?.hands?.[name],p=config?.exponent,d=config?.depth;
  if(!h||!Number.isFinite(p)||p<1||p>8||!Number.isFinite(d)||d<=0||d>2||
     !Number.isFinite(forwardOffset)||forwardOffset<0||forwardOffset>.01||
     !positions?.length||positions.length%3||!Array.from(positions).every(Number.isFinite))throw Error('Invalid hand-bound inputs');
  // This interval never crosses atan2's branch cut. Other trajectories need
  // their own reviewed bound, rather than borrowing this one.
  if([h.theta0,h.thetaHold].some(a=>!Number.isFinite(a)||Math.abs(a)>=Math.PI/2))throw Error('Unsupported entry angle branch');
  const heights=config.carrier.height,radii=config.carrier.radius;
  if(heights.length<2||heights.length!==radii.length||!radii.every(x=>Number.isFinite(x)&&x>0)||
     heights.some((x,i)=>!Number.isFinite(x)||(i&&x<=heights[i-1])))throw Error('Invalid carrier');
  const norm=a=>Math.hypot(...a),delta=(a,b)=>norm(a.map((v,i)=>v-b[i]));
  let rootRadius=0,gripRadius=0;
  for(let i=0;i<positions.length;i+=3){const v=Array.from(positions.slice(i,i+3));rootRadius=Math.max(rootRadius,delta(v,h.root));gripRadius=Math.max(gripRadius,delta(v,h.gripSource));}
  const radiusAt=y=>{
    if(y<=heights[0])return radii[0];
    for(let i=1;i<heights.length;i++)if(y<=heights[i])return radii[i-1]+(radii[i]-radii[i-1])*(y-heights[i-1])/(heights[i]-heights[i-1]);
    return radii.at(-1);
  };
  const sourceRadius=(Math.abs(h.root[0])**p+Math.abs(h.root[2]/d)**p)**(1/p);
  const correction=sourceRadius-radiusAt(h.root[1]);
  const dy=Math.abs(h.holdHeight-h.root[1]),dt=Math.abs(h.thetaHold-h.theta0);
  const radiusSlope=Math.max(...radii.slice(1).map((x,i)=>Math.abs((x-radii[i])/(heights[i+1]-heights[i]))));
  // The p-norm of (cos(theta),sin(theta)) is in [nMin,nMax] and is
  // nMax-Lipschitz in theta (reverse triangle inequality for p >= 1).
  const nMin=Math.min(1,2**(1/p-.5)),nMax=Math.max(1,2**(1/p-.5));
  const rMax=Math.max(...radii)+Math.abs(correction),rSpeed=radiusSlope*dy+Math.abs(correction);
  const alphaSpeed=dt*Math.max(d,1/d);
  const planarSpeed=Math.max(1,d)*(rSpeed/nMin+rMax*dt*(1/nMin+nMax/nMin**2));
  const entry=planarSpeed+dy+h.inset*(1+alphaSpeed)+norm(h.cupLocalHoldOffset)+rootRadius*alphaSpeed+forwardOffset;
  const rotationRate=Math.abs(sip.parameters.cupTiltX-hold.parameters.cupTiltX)+Math.abs(sip.parameters.cupYawY-hold.parameters.cupYawY);
  if(!Number.isFinite(rotationRate)||rotationRate>=Math.PI/2)throw Error('Unsupported half-rotation hemisphere');
  // fullDelta stays in w>0. Its quaternion square root has derivative norm
  // <= 2 times that of fullDelta: qHalf=(v/s,s/2), s=sqrt(2+2w)>=sqrt(2).
  // This deliberately overbounds the actual half-rotation angular speed.
  const lift=delta(sip.cupCenter,hold.cupCenter)+.0035*Math.PI+
    rotationRate*(norm(h.cupLocalGrip)+norm(h.cupLocalCorrection))+
    2*norm(h.cupLocalCorrection)+2*gripRadius*rotationRate+forwardOffset;
  if(![entry,lift].every(x=>Number.isFinite(x)&&x>=0))throw Error('Nonfinite hand bound');
  const theta=h.theta0,n=(Math.abs(Math.cos(theta))**p+Math.abs(Math.sin(theta))**p)**(1/p);
  const restTarget=[h.side*sourceRadius*Math.cos(theta)/n,h.root[1],d*sourceRadius*Math.sin(theta)/n];
  const restJoinError=delta(restTarget,h.root);
  const holdRotation=new T.Matrix4().makeRotationY(hold.parameters.cupYawY).multiply(new T.Matrix4().makeRotationX(hold.parameters.cupTiltX));
  const liftGripAtZero=new T.Vector3(...h.cupLocalGrip).applyMatrix4(holdRotation).add(new T.Vector3(...hold.cupCenter));
  return Object.freeze({entry,lift,rootRadius,gripRadius,rotationRate,restJoinError,liftGripAtZero:liftGripAtZero.toArray()});
}
