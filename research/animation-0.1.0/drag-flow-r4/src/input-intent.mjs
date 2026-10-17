/** Gesture classification in CSS device-independent pixels, never render pixels.
 * Default replay calibration is 55.2 DIP/world unit (276-DIP panel / ortho span 5).
 * The browser supplies raw client coordinates, so DPR and canvas backbuffer sizes do not enter. */
export const intentThresholds=Object.freeze({windowSeconds:.08,pickupDistanceDIP:1,slowProtectedSpeedDIP:42,fastSpeedDIP:64,hardFastSpeedDIP:120,fastSustainSeconds:.035,accelerationDIP:600,accelerationMinSpeedDIP:48,largeDistanceDIP:36,largeMinSpeedDIP:48,minimumFastDistanceDIP:3});
export class InputIntent {
 constructor(){this.reset(0,{x:0,y:0});}
 reset(t,p){this.origin={...p};this.points=[{t,...p}];this.lastTime=t;this.lastVelocity={x:0,y:0};this.candidateAt=null;this.candidateReason=null;this.fastLatched=false;this.latest=null;}
 observe(t,p){const k=intentThresholds,previous=this.points.at(-1),gap=t-previous.t;
  // A long stationary hold is not part of the new gesture's velocity denominator.
  if(gap>.12){this.points=[{t:t-k.windowSeconds,x:previous.x,y:previous.y}];this.lastVelocity={x:0,y:0};this.lastTime=t-k.windowSeconds;this.candidateAt=null;this.candidateReason=null;}
  if(t===this.points.at(-1).t)this.points[this.points.length-1]={t,...p};else this.points.push({t,...p});
  const from=Math.max(this.points[0].t,t-k.windowSeconds);let start=this.points[0];for(let i=1;i<this.points.length;i++){const b=this.points[i],a=this.points[i-1];if(b.t>=from){const u=b.t===a.t?1:(from-a.t)/(b.t-a.t);start={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};break;}}
  const dt=Math.max(1e-8,t-from),v={x:(p.x-start.x)/dt,y:(p.y-start.y)/dt},speed=Math.hypot(v.x,v.y),distance=Math.hypot(p.x-this.origin.x,p.y-this.origin.y),acceleration=Math.hypot(v.x-this.lastVelocity.x,v.y-this.lastVelocity.y)/Math.max(1/240,Math.min(k.windowSeconds,t-this.lastTime));
  let reason=null;if(distance>=k.minimumFastDistanceDIP){if(speed>=k.fastSpeedDIP)reason='fast-window-speed';else if(speed>=k.accelerationMinSpeedDIP&&acceleration>=k.accelerationDIP)reason='accelerating-gesture';else if(distance>=k.largeDistanceDIP&&speed>=k.largeMinSpeedDIP)reason='large-brisk-displacement';}
  if(reason&&this.candidateAt===null){this.candidateAt=t;this.candidateReason=reason;}else if(speed<=k.slowProtectedSpeedDIP+1e-9||distance<k.minimumFastDistanceDIP){this.candidateAt=null;this.candidateReason=null;}
  const hard=distance>=k.minimumFastDistanceDIP&&speed>=k.hardFastSpeedDIP;
  if(hard||(this.candidateAt!==null&&t-this.candidateAt>=k.fastSustainSeconds))this.fastLatched=true;
  this.latest={time:t,positionDIP:{...p},velocityDIP:v,speedDIP:speed,accelerationDIP:acceleration,distanceDIP:distance,fast:this.fastLatched,reason:hard?'hard-fast':this.candidateReason,protectedSlowBand:speed<=k.slowProtectedSpeedDIP+1e-9};this.lastVelocity=v;this.lastTime=t;
  while(this.points.length>2&&this.points[1].t<t-k.windowSeconds-.02)this.points.shift();return this.latest;
 }
}
