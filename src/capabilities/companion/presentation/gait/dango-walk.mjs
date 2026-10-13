import {DANGO_SOURCE_WALK as C} from '../../../../content/companion/gait/dango-walk.mjs';
const mod=x=>((x%1)+1)%1;
const smooth=x=>x*x*(3-2*x);
const integral=x=>x*x*x-.5*x*x*x*x;
const distance=2*C.stride/C.duty;
const constantTravel=q=>distance*q;
function assertFinite(value,name){if(!Number.isFinite(value))throw new TypeError(`${name} must be finite`);}
function sampleDangoSourceWalk(cycle,{groundY=C.groundY,travelAt=constantTravel,
 reducedMotion=false,staticWorldX=0,bobScale=1,view=C.view,outfit=C.outfit}={}){
 assertFinite(cycle,'cycle');assertFinite(groundY,'groundY');assertFinite(staticWorldX,'staticWorldX');assertFinite(bobScale,'bobScale');
 if(typeof travelAt!=='function'||bobScale<0||bobScale>1)throw new TypeError('valid travelAt and bobScale in [0,1] required');
 if(view!==C.view||outfit!==C.outfit)return {supported:false,reason:'unvalidated-view-or-outfit',runtimeReady:false,host:null};
 const q=reducedMotion?0:cycle,bodyX=reducedMotion?staticWorldX:travelAt(q);assertFinite(bodyX,'body travel');
 const feet=Object.entries(C.hips).map(([side,hip],i)=>{
  const local=q-i*.5,t=mod(local),landing=Math.floor(local)+i*.5,support=reducedMotion||t<=C.duty;
  // Mid-stance lookahead centers the planted foot without slipping. It also permits smooth start/stop travel.
  const planted=reducedMotion?staticWorldX+hip:travelAt(landing+C.duty/2)+hip;
  assertFinite(planted,'landing position');let x=planted,y=groundY-7,phase='support';
  if(!support){
   const u=(t-C.duty)/(1-C.duty),next=travelAt(landing+1+C.duty/2)+hip;
   assertFinite(next,'next landing');x+=(next-x)*smooth(u);y-=C.lift*16*u*u*(1-u)*(1-u);
   phase=u<.25?'toeoff':u<.65?'lift':'reach';
  }
  return {side,phase,support,source:C.foot.src,sourceSha256:C.foot.sha256,rootWorld:[x,y],
   soleWorld:[x, y+7],contactTarget:[planted,groundY],clearance:groundY-y-7,
   layer:'behind-footless-body',opacity:1};
 });
 return {supported:true,cycle:q,bodyWorld:[bodyX,groundY-C.groundY+(reducedMotion?0:.85*(1+Math.cos(4*Math.PI*q))*bobScale)],
  groundY,feet,supportCount:feet.filter(f=>f.support).length,flight:false,runtimeReady:false,host:null};
}
// Bounded example episode: stationary entry, accelerate, cruise, decelerate, settle both original feet.
// It does not own time or scheduling. The host may supply its own matching continuous world trajectory.
function sampleDangoWalkEpisode(progress,{groundY=C.groundY,reducedMotion=false}={}){
 assertFinite(progress,'progress');const p=Math.max(0,Math.min(1,progress)),q=p*4.6;
 const travel=x=>{
  if(x<=.5)return 0;
  if(x<1.5)return distance*integral(x-.5);
  if(x<=3)return distance*(.5+x-1.5);
  if(x<4){const u=x-3;return distance*(2+u-integral(u));}
  return distance*2.5;
 };
 const speed=q<=.5||q>=4?0:q<1.5?smooth(q-.5):q<=3?1:1-smooth(q-3);
 const sample=sampleDangoSourceWalk(q,{groundY,travelAt:travel,bobScale:speed,reducedMotion});
 return {...sample,episodeProgress:p,episodeComplete:p===1};
}

// Step-in-place has its own world contacts. It is not forward travel with the
// body offset subtracted: both stance feet remain at their original ground
// points, and the airborne foot makes a closed out-and-back recovery.
function sampleDangoStepInPlaceEpisode(progress, { reducedMotion = false, settle = 0 } = {}) {
 assertFinite(progress, 'progress');
 assertFinite(settle, 'settle');
 const strength = 1 - smooth(Math.max(0, Math.min(1, settle)));
 const p = Math.max(0, Math.min(1, progress)), q = p * 4.6;
 const envelope = q <= .5 || q >= 4 ? 0 : q < 1.5 ? smooth(q - .5) : q <= 3 ? 1 : 1 - smooth(q - 3);
 const sample = sampleDangoSourceWalk(q, { travelAt: () => 0, bobScale: envelope, reducedMotion });
 const feet = sample.feet.map(foot => {
  if (foot.support) return foot;
  const local = q - (foot.side === 'far' ? .5 : 0), u = (mod(local) - C.duty) / (1 - C.duty);
  const sweep = C.stride * 16 * u * u * (1 - u) * (1 - u) * (2 * u - 1);
  const x = C.hips[foot.side] + sweep * strength;
  const y = C.groundY - foot.clearance * strength;
  return { ...foot, support: strength === 0, phase: strength === 0 ? 'support' : foot.phase, clearance: foot.clearance * strength,
   rootWorld: [x, y - 7], soleWorld: [x, y] };
 });
 return { ...sample, bodyWorld: [0, sample.bodyWorld[1] * strength], feet, supportCount: feet.filter(foot => foot.support).length, episodeProgress: p, episodeComplete: p === 1, mode: 'step-in-place' };
}

export { sampleDangoSourceWalk, sampleDangoWalkEpisode, sampleDangoStepInPlaceEpisode };
