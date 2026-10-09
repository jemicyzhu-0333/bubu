'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const {createPetSurfaceClient}=require('../src/surfaces/pet/adapter/surface-client.mjs');
const {createPopoverSurfaceClient}=require('../src/surfaces/popover/adapter/surface-client.mjs');
const {validateIpcPayload,allowedSurfacesFor}=require('../src/application/ipc/route-catalog');
function load(surface){let bridge;const sent=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,`../src/preload-${surface}.js`),'utf8'),{
  require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'focuspix');bridge=value;}},
    ipcRenderer:{on(){},removeListener(){},invoke:(channel,payload)=>{const copy=structuredClone(payload);sent.push({channel,payload:copy});return validateIpcPayload(channel,copy);}}};}
});return{client:surface==='pet'?createPetSurfaceClient(bridge):createPopoverSurfaceClient(bridge),sent};}
for(const [surface,method,channel]of [['pet','pet_feed','pet:feed'],['popover','buyFood','pet:buy-food']])test(`${surface} actual preload/client preserves closed food identity and allowlist`,async()=>{
  const h=load(surface),request={foodId:'berry',commandId:'1000-contract',issuedAt:1000};
  assert.equal((await h.client[method](request)).ok,true);assert.deepEqual(h.sent[0],{channel,payload:request});
  assert.deepEqual(allowedSurfacesFor(channel),[surface]);
  for(const invalid of ['berry',{foodId:'berry'},{...request,amount:2},{...request,commandId:'1001-contract'}, {...request,commandId:'1000-space nope'}, {...request,issuedAt:1.5}, {...request,issuedAt:Number.MAX_SAFE_INTEGER}]){
    assert.equal((await h.client[method](invalid)).ok,false,JSON.stringify(invalid));
  }
});
for(const [method,channel,action]of [['resolveFocusLanding','pomodoro:resolve-focus-landing','skip'],['resolveQuickStart','pomodoro:resolve-quick-start','stop']])test(`${method} actual client/preload preserves false progress and rejects missing identity or truthy substitutes`,async()=>{
  const h=load('popover'),payload={sessionId:'session-one',progressMade:false,action,landingNote:null};
  assert.equal((await h.client[method](payload)).ok,true);assert.deepEqual(h.sent[0],{channel,payload});
  for(const invalid of [{...payload,sessionId:undefined},{...payload,progressMade:undefined},{...payload,progressMade:'true'},{...payload,progressMade:1},{...payload,other:true}]){
    assert.equal((await h.client[method](invalid)).ok,false);
  }
});
