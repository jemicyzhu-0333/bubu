import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const read=n=>JSON.parse(fs.readFileSync(new URL(n,import.meta.url)));
const C=read('contact-contract-candidate.json'),samples=read('initial-contact-family-samples.json');
const smooth=x=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
function value(x,env){if(typeof x==='number')return x;if(typeof x==='string'){assert.ok(x in env,`unknown variable ${x}`);return env[x];}if(x.variable)return env[x.variable];
 const a=()=>x.args.map(y=>value(y,env));switch(x.op){case'multiply':return a().reduce((x,y)=>x*y,1);case'add':return a().reduce((x,y)=>x+y,0);case'subtract':{const z=a();return z[0]-z[1];}case'divide':{const z=a();return z[0]/z[1];}case'max':return Math.max(...a());case'sin':return Math.sin(value(x.radians,env));case'smoothstep':return smooth(value(x.input,env));case'pulse':{const p=env[x.input],[a,b,c,d]=x.edges;return smooth((p-a)/(b-a))*(1-smooth((p-c)/(d-c)));}default:throw Error(`unsupported data op ${x.op}`);}}
function envFor(action,p){const e={progress:p,pi:Math.PI};for(const[k,v]of Object.entries(action.timing||{}))e[k]=value(v,e);return e;}
function matches(x,e){if(x.op==='range')return e[x.variable]>=x.min&&(x.includeMax?e[x.variable]<=x.max:e[x.variable]<x.max);if(x.op==='gt')return value(x.left,e)>value(x.right,e);if(x.op==='lte')return value(x.left,e)<=value(x.right,e);throw Error(`unsupported predicate ${x.op}`);}
function walk(x,fn,path=[]){if(x&&typeof x==='object'){fn(x,path);for(const[k,v]of Object.entries(x))walk(v,fn,[...path,k]);}}

test('portable candidate declares no production permission, mutation, or blanket score',()=>{
 assert.equal(C.schema,'dango-contact-contract-candidate/1');assert.equal(C.productionReady,false);assert.equal(C.status,'audit-only');assert.deepEqual(C.scope.stateWrites,[]);assert.equal(C.scope.allowsGlobalClosedPalmRoot,false);
 assert.equal(C.censusPolicy.legacySampleCount,1707);assert.ok(C.censusPolicy.mustPartitionBy.includes('role'));assert.ok(C.censusPolicy.mustPartitionBy.includes('phase'));
 assert.ok(!JSON.stringify(C).includes('/workspace/'));assert.ok(!JSON.stringify(C).includes('file://'));
});
test('all phase roles are closed and expected contact agrees with role semantics',()=>{for(const a of Object.values(C.actions))for(const h of Object.values(a.hands))for(const p of h.phases){assert.ok(C.roles[p.role],p.role);assert.equal(p.contactExpected,C.roles[p.role].requiresPhysicalContact);}});
test('every present hand has exactly one ordinary phase across dense samples and boundaries',()=>{
 for(const[id,a]of Object.entries(C.actions))for(const[side,h]of Object.entries(a.hands))for(let i=0;i<=1000;i++){const e=envFor(a,i/1000),present=h.presence?matches(h.presence,e):true;assert.equal(h.phases.filter(p=>matches(p.when,e)).length,present?1:0,`${id}/${side}/${i}`);}
 for(const p of [0,.08,.34,.66,.92,1])for(const h of Object.values(C.actions['sip-tea'].hands))assert.equal(h.phases.filter(q=>matches(q.when,{progress:p})).length,1);
});
test('cup contact roles and actual per-hand tool anchors reproduce measured final targets',()=>{
 for(const id of ['hiccup','sip-tea'])for(const row of samples.filter(r=>r.id===id))for(const hand of row.hands){const h=C.actions[id].hands[hand.side];assert.equal(h.roleIntent,'continuous_grip');assert.ok(h.phases.every(p=>p.target.kind==='tool_anchor'));assert.equal(h.surface.normal.value,null);assert.equal(h.surface.normal.status,'blocked');
  const at=h.propAnchor.local;assert.ok(Math.abs(hand.target[0]-(row.tool.x+at[0]))<1e-8);assert.ok(Math.abs(hand.target[1]-(row.tool.y+at[1]))<1e-8);
 }
 assert.notEqual(C.actions.hiccup.hands.left.surface.kind,C.actions.hiccup.hands.right.surface.kind);
});
test('keyboard JSON timing reproduces legacy guide trajectories without asserting them as underside contact',()=>{
 const a=C.actions['type-keyboard'];for(const row of samples.filter(r=>r.id==='type-keyboard'&&r.requestedView==='front'))for(const hand of row.hands){const h=a.hands[hand.side],at=h.propAnchor.local,e=envFor(a,row.p);e['tool-anchor-x']=row.tool.x+at[0];
 const x=value(h.guideTrajectory.targetX,e),y=row.tool.y+at[1]-2-value(h.guideTrajectory.lift,e);assert.ok(Math.abs(x-hand.target[0])<1e-8);assert.ok(Math.abs(y-hand.target[1])<1e-8);assert.equal(h.oldPointRole.pointsEnd,'legacy-palm-center-guide');assert.equal(h.guideTrajectory.pointToContactConversion.status,'blocked');assert.equal(h.surface.normal.value,null);
 }
 for(const p of [.05,.10,.2,.3,.45,.6,.75]){const e=envFor(a,p);if(Math.abs(e.tap)<1e-9)continue;const roles=Object.values(a.hands).map(h=>h.phases.find(p=>matches(p.when,e)).role);assert.deepEqual(roles.sort(),['free_gesture','point_touch']);}
});
test('catch auxiliary left hand is free with no invented prop anchor or normal',()=>{
 const a=C.actions['catch-star'],h=a.hands.left;assert.equal(h.roleIntent,'free_gesture');assert.equal(h.propAnchor,null);assert.equal(h.surface,null);assert.equal(h.normal.status,'not-applicable');assert.equal(h.normal.value,null);assert.deepEqual(h.relativeTargetToStarOrigin,[-1.5,17]);assert.ok(h.phases.every(p=>p.role==='free_gesture'&&!p.contactExpected));assert.deepEqual(Object.keys(a.tool.localAnchors),['right']);
});
test('unknown normals remain blocked; registered support normals identify actual source evidence',()=>{
 for(const id of ['hiccup','sip-tea','type-keyboard'])for(const h of Object.values(C.actions[id].hands)){assert.equal(h.surface.normal.value,null);assert.equal(h.surface.normal.status,'blocked');assert.equal(h.status.status,'blocked');}
 for(const h of Object.values(C.actions.workout.hands)){const n=h.surface.normal;assert.deepEqual(n.value,[0,1]);assert.equal(n.status,'source-registered-candidate');for(const ref of Object.values(n.sourceByView)){assert.deepEqual(C.evidence[ref].projectedNormal,n.value);assert.match(C.evidence[ref].sha256,/^[a-f0-9]{64}$/);}assert.equal(h.surface.desiredCenterY,'local-floor-y - 0.5');assert.equal(h.status.status,'blocked');}
});
test('static holding, dynamic touches, free gestures and support use separate acceptance',()=>{
 assert.equal(C.roles.continuous_grip.acceptance,'continuous-held-contact');assert.equal(C.roles.point_touch.acceptance,'phase-gated-touch');assert.equal(C.roles.free_gesture.acceptance,'free-gesture-silhouette');assert.equal(C.roles.planted_support.acceptance,'fixed-support-surface');
 assert.equal(C.acceptanceProfiles['continuous-held-contact'].markerToleranceArt,null);assert.equal(C.acceptanceProfiles['fixed-support-surface'].maxPenetrationArt,0);assert.equal(C.acceptanceProfiles['free-gesture-silhouette'].requiresPropAnchor,false);
});
test('source-contact keyframes may replace genericIK only inside a declared source-backed contact contract',()=>{
 const r=C.realizationAlternatives['source-contact-frames'];assert.equal(r.allowedAsCandidate,true);assert.equal(r.genericIKRequired,false);assert.ok(r.mustDeclare.includes('coverage of transition frames'));assert.ok(r.mustDeclare.includes('open-root natural join'));assert.ok(r.forbidden.includes('claiming static keys prove whole animation'));assert.equal(C.realizationAlternatives['generic-IK'].notRequired,true);
});
test('handoff release is instance-scoped and never contaminates ordinary sip phases',()=>{
 const a=C.actions['sip-tea'],o=a.instanceOverrides[0];assert.equal(o.scope,'only-this-handoff-instance');assert.equal(o.phases[1].role,'free_gesture');assert.deepEqual(o.phases[1].range,[.7,1]);for(const h of Object.values(a.hands))assert.ok(h.phases.every(p=>p.role==='continuous_grip'));
});
test('measured evidence digest is intact and candidate contains no executable code',()=>{
 const bytes=fs.readFileSync(new URL('initial-contact-family-samples.json',import.meta.url));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),C.evidence.sampledFamilies.sha256);
 walk(C,(o)=>{assert.ok(!('javascript' in o));assert.ok(!('eval' in o));assert.ok(!('script' in o));});
});
