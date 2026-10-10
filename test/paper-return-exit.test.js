'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaperReturnExit } = require('../src/surfaces/pet/paper-return-exit.mjs');
const { samplePaperReturn } = require('../src/capabilities/companion/presentation/paper-return-story.mjs');
const result = (id, p) => ({ actionConfig: id ? { id } : null, actionT: p });
const options = (now, id = 'paper-return', extra = {}) => ({ now, egg: id ? { id, manual:true } : null,
  actionStartedAt: 0, form: { id: 'usagi' }, combinationContext: { state: { state: 'idle' } }, ...extra });
test('one bounded paper exit preserves initial pose, closes its prop and hands without teleport', () => {
  for (const progress of [.22, .53, .77]) {
    const start = samplePaperReturn(progress), first = samplePaperReturn(progress, false, { progress, t: 0 });
    assert.deepEqual(first.hand, start.hand); assert.deepEqual(first.grip, start.grip);
    let previous = first;
    for (let n = 1; n <= 84; n++) {
      const current = samplePaperReturn(progress, false, { progress, t: n / 84 });
      assert.ok(Math.hypot(...current.grip.map((v,i)=>v-previous.grip[i])) < 2);
      previous = current;
    }
    assert.equal(previous.opacity, 0); assert.deepEqual(previous.hand, [59,49]);
  }
});
test('A to B to C keeps one exit; incoming take-up starts at zero and finishes on its deadline', () => {
  const bridge = createPaperReturnExit(); bridge.step(result('paper-return', .5), options(0));
  const first = bridge.step(result('sip-tea', 0), options(30,'sip-tea'));
  assert.equal(first.actionConfig.id,'paper-return'); assert.equal(first.actionConfig.paperReturnExit.t,0);
  const replaced = bridge.step(result('wave',.01),options(230,'wave'));
  assert.equal(replaced.actionConfig.paperReturnExit.t,200/420);
  const resumed = bridge.step(result('wave',.06),options(450,'wave'));
  assert.equal(resumed.actionConfig.id,'wave'); assert.equal(resumed.actionT,0);
  assert.equal(bridge.step(result('wave',1),options(4000,'wave')).actionT,1);
});
test('calm, drag, sleep, walking, celebration, form switch and reset immediately discard recovery', () => {
  for (const extra of [{calmVisual:true},{combinationContext:{state:{dragging:true}}},
    ...['sleeping','dragged','resting','walking','celebrating'].map(state=>({combinationContext:{state:{state}}})),{form:{id:'dango'}},{preview:{category:'action'}}]) {
    const bridge=createPaperReturnExit();bridge.step(result('paper-return',.5),options(0));bridge.step(result('sip-tea',0),options(30,'sip-tea'));
    assert.equal(bridge.step(result('sip-tea',.1),options(90,'sip-tea',extra)).actionConfig.id,'sip-tea');
    assert.equal(bridge.step(result('wave',0),options(120,'wave')).actionConfig.id,'wave');
  }
  const bridge=createPaperReturnExit();bridge.step(result('paper-return',.5),options(0));bridge.reset();
  assert.equal(bridge.step(result('sip-tea',0),options(30,'sip-tea')).actionConfig.id,'sip-tea');
});
test('same story restarts close once; rollback and actual priority sources discard the snapshot', () => {
  const bridge=createPaperReturnExit();bridge.step(result('paper-return',.6),options(100));
  assert.equal(bridge.step(result('paper-return',0),options(130,'paper-return',{actionStartedAt:130})).actionConfig.paperReturnExit.t,0);
  assert.equal(bridge.step(result('sip-tea',0),options(90,'sip-tea')).actionConfig.id,'sip-tea');
  for(const source of ['input-safe','essential','session']) {
    const b=createPaperReturnExit();b.step(result('paper-return',.5),options(0));
    const o=options(30,'sip-tea',{combinationContext:{state:{state:'idle'},source}});
    assert.equal(b.step(result('sip-tea',0),o).actionConfig.id,'sip-tea');
  }
  for(const flag of ['commandMenuOpen','foodMenuOpen','devtoolsOpen','screenLocked','sessionPaused','dockedEdge']) {
    const b=createPaperReturnExit();b.step(result('paper-return',.5),options(0));
    assert.equal(b.step(result('sip-tea',0),options(30,'sip-tea',{combinationContext:{state:{state:'idle',[flag]:true}}})).actionConfig.id,'sip-tea');
  }
});
test('handoff tea closes only its own prop and keeps a primitive legal-view hint after actual deadline', () => {
  const bridge=createPaperReturnExit();
  const tea=now=>options(now,'sip-tea',{egg:{id:'sip-tea',manual:true,duration:9000,presentationEventId:'tea.1'},actionStartedAt:30,viewFor:()=> 'three-quarter'});
  bridge.step(result('paper-return',.5),options(0));bridge.step(result('sip-tea',0),tea(30));
  bridge.step(result('sip-tea',.05),tea(480));
  const end=bridge.step(result('sip-tea',1),tea(9030));
  assert.equal(end.actionConfig.handoffRecovery,1);assert.equal(end.actionConfig.propOpacity,0);
  const idle=bridge.step(result(null,0),options(9060,null));
  assert.equal(idle.actionConfig,null);assert.equal(idle.viewHint,'three-quarter');
  assert.equal(bridge.step(result(null,0),options(99000,null)).viewHint,'three-quarter');
  assert.equal(bridge.step(result('wave',0),options(99030,'wave')).viewHint,undefined);
  const plain=createPaperReturnExit();assert.equal(plain.step(result('sip-tea',.99),tea(9000)).actionConfig.handoffRecovery,undefined);
});
test('sparse-frame natural expiry may keep view, but early cancel and priority feedback do not',()=>{
  for(const [end,expected]of [[9030,'three-quarter'],[1000,undefined]]){
    const b=createPaperReturnExit(),tea=now=>options(now,'sip-tea',{egg:{id:'sip-tea',manual:true,duration:9000},actionStartedAt:30,viewFor:()=> 'three-quarter'});
    b.step(result('paper-return',.5),options(0));b.step(result('sip-tea',0),tea(30));b.step(result('sip-tea',.05),tea(480));
    assert.equal(b.step(result(null,0),options(end,null)).viewHint,expected);
    assert.equal(b.step(result(null,0),options(end+30,null,{combinationContext:{state:{state:'idle'},source:'interaction'}})).viewHint,undefined);
  }
});
test('Dango tea recovery has no connector switch at onset and leaves no floating paws at completion',()=>{
  const { refineHandoffCup }=require('../src/capabilities/companion/presentation/dango-paper-return.mjs');
  const contact={tools:[{key:'cup',x:35,y:43}],details:[{type:'steam',at:[40,42]}],hands:[{side:'right',points:[[60,42],[57,46],[55,50]]}]};
  const data={parts:{'hand-right':{pivot:[61,45],rect:[57,42,9,7]}}};
  const start=refineHandoffCup(structuredClone(contact),{id:'sip-tea',handoffRecovery:1e-8,propOpacity:1},data);
  assert.equal(start.hands[0].connector,undefined);
  assert.ok(Math.hypot(...start.hands[0].points[1].map((n,i)=>n-contact.hands[0].points[1][i]))<1e-10);
  const end=refineHandoffCup(structuredClone(contact),{id:'sip-tea',handoffRecovery:1,propOpacity:0},data);
  assert.equal(end.hands[0].opacity,0);assert.deepEqual(end.hands[0].points[2],[61,45]);assert.equal(end.details[0].opacity,0);
  assert.deepEqual(refineHandoffCup(structuredClone(contact),{id:'sip-tea'},data),contact);
});
