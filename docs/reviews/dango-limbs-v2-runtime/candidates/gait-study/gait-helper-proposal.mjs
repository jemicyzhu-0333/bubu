// Candidate pure helper. This is not production integration or animation acceptance.
// Source frames are observed anatomical states; support/flight timing is authored here.
const mod = x => ((x % 1) + 1) % 1;
const smooth = x => x*x*(3-2*x);
const half = x => Math.round(x - .5) + .5;
const families = {
  near: {hipX:21.178747, support:'near-support', swing:['near-trailing','near-recovery','near-reach']},
  far: {hipX:47.801009, support:'far-support', swing:['far-recovery','far-forward','far-reach']}
};
export function sampleGait(q, frames, {mode='run', groundY=64.5, stride=3.5, lift=4, travelAt=null}={}) {
  if (!Number.isFinite(q)) throw new TypeError('finite gait cycle required');
  if (!['run','walk'].includes(mode)) throw new TypeError('unknown gait mode');
  // Walk uses longer stance => double support; run has two true flight intervals.
  const duty=mode==='run'?.36:.62;
  const distance=2*stride/duty;
  const bodyX = travelAt || (cycle => cycle*distance);
  const records=[];
  for (const [index, role] of ['near','far'].entries()) {
    const spec=families[role], offset=index*.5, local=q-offset;
    const landing=Math.floor(local)+offset, t=mod(local), support=t<=duty;
    const stand=frames.find(f=>f.id===spec.support);
    if (!stand) throw new Error(`missing ${spec.support}`);
    const stanceDelta=stand.sole[0]-stand.root[0];
    const landedX=half(bodyX(landing)+spec.hipX+stride+stanceDelta);
    let soleX=landedX, soleY=groundY, id=spec.support, swingRoot=null;
    if (!support) {
      const u=(t-duty)/(1-duty);
      // A planted foot remains in world space during stance; swing goes to its next landing.
      const nextX=half(bodyX(landing+1)+spec.hipX+stride+stanceDelta);
      id=u<.15?spec.support:u<.35?spec.swing[0]:u<.55?spec.swing[1]:u<.85?spec.swing[2]:spec.support;
      const extra=Math.max(...spec.swing.map(id=>{const f=frames.find(x=>x.id===id);return f.sole[1]-f.root[1]-(stand.sole[1]-stand.root[1]);}));
      // Keep the anatomical root trajectory continuous across source-frame changes.
      // Start/end on the same support anatomy; extra lift clears longer angled feet.
      swingRoot=[landedX-stanceDelta+(nextX-landedX)*smooth(u),groundY-(stand.sole[1]-stand.root[1])-(lift+extra)*Math.sin(Math.PI*u)];
    }
    const f=frames.find(f=>f.id===id); if(!f) throw new Error(`missing ${id}`);
    // Integer translations only: every local root/sole is a half-pixel center.
    const rootWorld=swingRoot?swingRoot.map(half):[half(soleX-(f.sole[0]-f.root[0])),half(soleY-(f.sole[1]-f.root[1]))];
    const soleWorld=rootWorld.map((v,k)=>v+f.sole[k]-f.root[k]);
    records.push({role, frame:id, phase:t, support, landingCycle:landing,
      contactTarget:[landedX,groundY], rootWorld, soleWorld,
      clearance:groundY-soleWorld[1], unquantizedClearance:swingRoot?groundY-swingRoot[1]-(f.sole[1]-f.root[1]):0,
      layer:support?'back':'split-root-back-distal-front'});
  }
  return {q, mode, bodyWorldX:bodyX(q), groundY, feet:records,
    supportCount:records.filter(f=>f.support).length,
    flight:records.every(f=>!f.support && f.clearance>0), airborneIntent:records.every(f=>!f.support),
    warning:'Frame-switch silhouette/ankle continuity and actual host ground transform require runtime validation.'};
}
