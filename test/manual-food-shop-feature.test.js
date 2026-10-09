'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverFoodShop } = require('../src/surfaces/popover/features/food-shop.mjs');
const { createPopoverCompanionFeature } = require('../src/surfaces/popover/features/companion.mjs');
const { renderFoodCollection } = require('../src/surfaces/popover/features/food-collection.mjs');
const { element, dom } = require('../test-support/manual-growth-dom');
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
const snapshot = () => ({ revision: 1, level: 1, foodShop: { foodTickets: 6, items: [{id:'berry',name:'浆果',emoji:'',price:1,level:1,inventory:2,affordable:true,unlocked:true}] } });
function fixture() {
  const { $ } = dom(), sent=[], animations=[]; let state=snapshot(), now=1000, hidden;
  let submit = async () => ({ok:true,foodTickets:5}), refresh=async () => state;
  const button=element(); button.dataset.foodId='berry'; button.closest=() => button; $('#foodShopPanel').open=true;
  const feature=createPopoverFoodShop({ $,getState:()=>state,
    surfaceClient:{ buyFood:request=>{sent.push(request);return submit(request);},onPopoverHidden:fn=>{hidden=fn;} },
    render:()=>{button.disabled=feature.busy('berry');},now:()=>now,nonce:()=>`fixture${sent.length}`,
    onSuccess:()=>animations.push(true) });
  feature.mount({refresh:()=>refresh()});
  return { $,feature,sent,animations,button,click:()=>$('#foodShopList').emit('click',{target:button}),hidden:()=>hidden(),
    setSubmit:fn=>{submit=fn;},setRefresh:fn=>{refresh=fn;},setNow:value=>{now=value;},setState:value=>{state=value;} };
}
test('actual shop feature double clicks once and preserves unknown command identity', async () => {
  const h=fixture(), pending=deferred(); h.setSubmit(()=>pending.promise);
  const a=h.click(); await h.click(); assert.equal(h.sent.length,1);
  pending.reject(new Error('unknown commit'));await a;
  h.setSubmit(async()=>({ok:true,foodTickets:5,replayed:true}));await h.click();
  assert.deepEqual(h.sent[0],h.sent[1]);assert.equal(h.animations.length,1);assert.match(h.$('#foodShopStatus').textContent,/5 张/);
});
test('shop failed refresh cannot release expired identity; successful refresh requires another click', async () => {
  const h=fixture();h.setSubmit(async()=>null);await h.click();h.setNow(601001);
  h.setRefresh(async()=>{throw Error('offline');});await h.click();assert.equal(h.sent.length,1);
  h.setRefresh(async()=>({ok:false}));await h.click();assert.equal(h.sent.length,1);
  h.setRefresh(async()=>snapshot());await h.click();assert.equal(h.sent.length,1);assert.match(h.$('#foodShopStatus').textContent,/核对后/);
  await h.click();assert.equal(h.sent.length,2);assert.notEqual(h.sent[0].commandId,h.sent[1].commandId);
});
for(const failure of [false,true])test(`shop close/reopen ignores stale ${failure?'failure':'success'} but recovers controls`,async()=>{
  const h=fixture(),pending=deferred();h.setSubmit(()=>pending.promise);const old=h.click();
  h.$('#foodShopPanel').open=false;await h.$('#foodShopPanel').emit('close');
  h.$('#foodShopPanel').open=true;await h.$('#foodShopPanel').emit('toggle');h.$('#foodShopStatus').textContent='new visit';
  if(failure)pending.reject(Error('old'));else pending.resolve({ok:true,foodTickets:5});await old;
  assert.equal(h.$('#foodShopStatus').textContent,'new visit');assert.equal(h.animations.length,0);assert.equal(h.button.disabled,false);
});
test('shop hidden/disposed receipts cannot alter a new status or animate',async()=>{
  const h=fixture(),pending=deferred();h.setSubmit(()=>pending.promise);const old=h.click();h.hidden();h.feature.dispose();
  h.$('#foodShopStatus').textContent='new screen';pending.resolve({ok:true,foodTickets:5});await old;
  assert.equal(h.$('#foodShopStatus').textContent,'new screen');assert.equal(h.animations.length,0);
});
test('unknown shop request stays reachable after the last ticket was spent in an unseen commit',()=>{
  const {$}=dom();const shop=snapshot().foodShop;shop.items[0].affordable=false;
  renderFoodCollection({$,escapeHTML:x=>x,shop,level:1,pending:()=>true});
  assert.match($('#foodShopList').innerHTML,/核对上次兑换/);assert.doesNotMatch($('#foodShopList').innerHTML,/ disabled/);
});
test('actual companion renderer shows tickets and active-role tastes, excludes basic from the shop',()=>{
  const {$}=dom();let state=snapshot();state.foodShop.items.push({id:'basic',price:0});
  state.companionProjection={role:'dango',satiation:65,bond:{points:2,label:'初识',percent:5},tastes:[]};
  const feature=createPopoverCompanionFeature({getState:()=>state,$,escapeHTML:String,skinAccent:()=>({}),surfaceClient:{buyFood(){}}});
  feature.renderCompanion();assert.equal($('#foodShopBalance').textContent,'食物券 6 张');assert.doesNotMatch($('#foodShopList').innerHTML,/data-food-card="basic"/);
  assert.match($('#foodShopList').innerHTML,/1 张食物券/);assert.doesNotMatch($('#foodShopList').innerHTML,/ XP/);
  state={...state,companionProjection:{...state.companionProjection,role:'usagi',bond:{points:0,label:'刚认识',percent:0}}};
  feature.renderCompanion();assert.equal($('#bondStage').textContent,'刚认识');
});
