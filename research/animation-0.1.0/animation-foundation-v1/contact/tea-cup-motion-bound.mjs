/** Conservative displacement of every cup-assembly surface point from the
 * interval midpoint. Caller must split at all timeline/cancellation knots so
 * lift, entry and scale are each monotone on the closed interval.
 * Rotation is Ry(yaw) Rx(tilt), matching the frozen rigid-tea controller. */
export function cupMotionBound(start,middle,end,{hold,sip,radius}) {
  if(!(Number.isFinite(radius)&&radius>=0))throw Error('Finite cup radius required');
  const variation=key=>{
    const values=[start[key],middle[key],end[key]];
    if(values.some(v=>!Number.isFinite(v)||v<0||v>1)||middle[key]<Math.min(start[key],end[key])-1e-12||middle[key]>Math.max(start[key],end[key])+1e-12)throw Error('Monotone unit interval required');
    return Math.max(Math.abs(start[key]-middle[key]),Math.abs(end[key]-middle[key]));
  };
  const lift=variation('lift'),entry=variation('handEntry'),scale=variation('cupScale');
  const centerRate=Math.hypot(...sip.cupCenter.map((x,i)=>x-hold.cupCenter[i]));
  const rotationRate=Math.abs(sip.parameters.cupTiltX-hold.parameters.cupTiltX)+Math.abs(sip.parameters.cupYawY-hold.parameters.cupYawY);
  // sin(pi*u) is pi-Lipschitz. e*(1-u) is 1-Lipschitz in each argument.
  return (centerRate+.0035*Math.PI)*lift+.0098*(entry+lift)
    +radius*(scale+Math.max(start.cupScale,end.cupScale)*rotationRate*lift)+1e-12;
}
