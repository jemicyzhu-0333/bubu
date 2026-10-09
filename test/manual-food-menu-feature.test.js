'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetFoodMenu } = require('../src/surfaces/pet/food-menu.mjs');
const { dom } = require('../test-support/manual-growth-dom');
const { FOODS } = require('../src/pet-content');
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
const snapshot = () => ({ satiation: 40,foodInventory:{berry:2},foodTickets:6,totalFeeds:0,basicMeal:{dayKey:'2026-10-07',limit:3,remaining:3,eligible:true,reason:null} });
function fixture() {
  const {$,document}=dom();let read=async()=>snapshot(),send=async()=>({ok:true}),open=false;
  const sent=[],focused=[],speech=[],scheduled=[];
  Object.defineProperty($('#foodList'),'innerHTML',{set(){this.children=[];},get(){return '';}});
  const menu=createPetFoodMenu({document,client:{pet_getFeedState:()=>read(),pet_feed:request=>{sent.push(request);return send(request);}},content:()=>({FOODS}),
    setOpen:value=>{open=value;},available:()=>true,beforeOpen:()=>menu.feed.cancel('menu-open'),closeCommandMenu:async()=>{},expand:async()=>({side:'right'}),changed(){},
    focusReturn:()=>focused.push(true),requestFrame:fn=>scheduled.push(fn),updateSatBar(){},
    feeding:{clock:{read:()=>0},now:()=>1000,nonce:()=>`menu${sent.length}`,present(){},say:value=>speech.push(value)} });
  return {$,menu,sent,speech,focused,scheduled,isOpen:()=>open,setRead:fn=>{read=fn;},setSend:fn=>{send=fn;},button:id=>$('#foodList').children.find(node=>node.dataset.food===id)};
}
test('menu basic food is truthful at fractional hunger, max55, remaining allowance, and no-stock gates',async()=>{
  const h=fixture();await h.menu.open();let basic=h.button('basic');assert.equal(basic.disabled,false);assert.match(basic.children[1].children[1].textContent,/最多到 55/);
  assert.equal(basic.children[2].textContent,'今日余 3');h.menu.update({...snapshot(),satiation:45.5,basicMeal:{remaining:2,eligible:false}});
  basic=h.button('basic');assert.equal(basic.disabled,true);assert.match(basic.children[1].children[1].textContent,/不高于 45/);
  h.menu.update({...snapshot(),basicMeal:{remaining:0,eligible:false}});assert.match(h.button('basic').children[1].children[1].textContent,/已用完/);
  assert.equal(h.button('cake'),undefined);assert.doesNotMatch(h.$('#foodDaily').textContent,/XP/);
});
test('menu double opening and close during read do not resurrect the old visit',async()=>{
  const h=fixture(),pending=deferred();let reads=0;h.setRead(()=>{reads++;return pending.promise;});
  const old=h.menu.open();await h.menu.open();assert.equal(reads,1);await h.menu.close();
  h.setRead(async()=>snapshot());await h.menu.open();h.$('#foodDaily').textContent='new visit';
  pending.resolve({...snapshot(),foodInventory:{berry:99}});await old;
  assert.equal(h.$('#foodDaily').textContent,'new visit');assert.equal(h.button('berry').children[2].textContent,'×2');assert.equal(h.isOpen(),true);
});
test('menu pending read cannot overwrite a later canonical push, and stale frame cannot steal focus',async()=>{
  const h=fixture(),pending=deferred();h.setRead(()=>pending.promise);const opening=h.menu.open();
  h.menu.update({...snapshot(),foodInventory:{berry:8}});pending.resolve(snapshot());await opening;
  assert.equal(h.button('berry').children[2].textContent,'×8');await h.menu.close();
  for(const frame of h.scheduled)frame();assert.equal(h.$('#foodClose').focusCount,0);
});
test('unresolved feed stays reachable after own canonical push removes last stock',async()=>{
  const h=fixture(),pending=deferred();await h.menu.open();h.setSend(()=>pending.promise);
  const operation=h.menu.feed.feedPet('berry');h.menu.update({...snapshot(),foodInventory:{berry:0},totalFeeds:1});
  assert.equal(h.button('berry').disabled,true);pending.reject(Error('unknown after commit'));await operation;
  assert.equal(h.button('berry').disabled,false);assert.match(h.button('berry').children[1].children[1].textContent,/核对上次/);
  h.setSend(async()=>({ok:true,replayed:true}));await h.menu.feed.feedPet('berry');assert.deepEqual(h.sent[0],h.sent[1]);
});
test('close/reopen retains unknown identity and ignores old successful meal speech',async()=>{
  const h=fixture(),pending=deferred();await h.menu.open();h.setSend(()=>pending.promise);
  const operation=h.menu.feed.feedPet('berry');await h.menu.close();await h.menu.open();
  pending.resolve({ok:true,reaction:'old speech'});await operation;
  assert.equal(h.speech.length,0);assert.equal(h.button('berry').disabled,false);
});
