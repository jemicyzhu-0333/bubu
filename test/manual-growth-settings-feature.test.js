'use strict';
const test = require('node:test');const assert = require('node:assert/strict');
const {dom}=require('../test-support/manual-growth-dom');
const {DEFAULT_SETTINGS}=require('../src/capabilities/preferences/contract/settings');
const {createPopoverSettingsDrawer}=require('../src/surfaces/popover/features/settings-drawer.mjs');
const {createPopoverAppChrome}=require('../src/surfaces/popover/features/app-chrome.mjs');

test('actual settings drawer keeps meal AI default-off, saves explicit toggles, and refreshes cache/reopen', async t=>{
  const {$,document}=dom(),sent=[];let state={settings:{...DEFAULT_SETTINGS},ai:{enabled:false}};
  const before=global.requestAnimationFrame;global.requestAnimationFrame=fn=>fn();t.after(()=>{global.requestAnimationFrame=before;});
  const feature=createPopoverSettingsDrawer({document,$,$$:()=>[],getState:()=>state,surfaceClient:{updateSettings:async patch=>{sent.push(patch);state={...state,settings:{...state.settings,...patch}};return{ok:true};}},
    sessionDuration:{},syncPressedButtons(){},fallbackReasonText:()=>'',motionReduced:()=>false,clearDecorativeMotion(){},renderExpiryPreview(){},
    activeLandingPrompt:()=>null,rememberLandingReturnFocus(){},renderLanding(){}});
  t.after(()=>feature.dispose());feature.mount();feature.renderSettings();
  const toggle=$('[data-toggle="aiPetMealsEnabled"]');assert.equal(state.settings.aiPetMealsEnabled,false);assert.equal(toggle.attributes['aria-pressed'],'false');assert.equal(toggle.textContent,'关');
  await toggle.emit('click');await new Promise(setImmediate);assert.deepEqual(sent,[{aiPetMealsEnabled:true}]);feature.renderSettings();assert.equal(toggle.attributes['aria-pressed'],'true');
  feature.close();feature.open();feature.renderSettings();assert.equal(toggle.textContent,'开');
  state={...state,settings:{...state.settings,aiPetMealsEnabled:false}};feature.renderSettings();assert.equal(toggle.textContent,'关');
  assert.equal(state.ai.enabled,false,'feature choice does not switch on master AI or run a provider');
});
test('actual header renders current levelCost, including capped levels and same-level projection changes',()=>{
  const {$,document}=dom();let state={level:1,xp:20,levelCost:30,settings:{}};
  const feature=createPopoverAppChrome({document,$,$$:()=>[],getState:()=>state,getSession:()=>({status:'idle'}),surfaceClient:{},escapeHTML:String,nextRovingIndex(){},onTabShown(){}});
  feature.renderHeader();assert.equal($('#xpText').textContent,'20 / 30 XP');assert.equal($('#xpProgress').attributes['aria-valuemax'],'30');
  state={...state,level:20,xp:400,levelCost:450};feature.renderHeader();assert.equal($('#xpText').textContent,'400 / 450 XP');
  state={...state,levelCost:440};feature.renderHeader();assert.equal($('#xpText').textContent,'400 / 440 XP');
});
