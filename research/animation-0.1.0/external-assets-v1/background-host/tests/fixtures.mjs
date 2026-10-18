import {createSceneCoordinator} from '../fixtures/upstream/coordinator.mjs';
import {backgrounds} from '../src/background-descriptors.mjs';
import {createEnvironmentPool} from '../src/environment-pool.mjs';
import {createEnvironmentHost} from '../src/environment-host.mjs';
export const calibration = {width:220,height:220,projectedBodyWorldWidth:1.2,actorAnchor:[0,.6,0],floorY:0};
export function fixture({load} = {}) {
  let now=0, selected=0;
  const coordinator=createSceneCoordinator({policyVersion:'fixture-policy',maxOverlays:1,
    sources:[{id:'routine',kind:'theme'},{id:'feed',kind:'theme'},{id:'detection',kind:'detection'}],
    backgrounds:[{id:'focused',approved:true,ready:true}],
    recipes:[{id:'coffee-decoration',factKey:'theme:coffee',kind:'overlay',resources:['overlay.coffee'],
      approved:true,ready:true,mode:'sustained',layer:1}],conflicts:[],overlayOrder:['coffee-decoration']},
    {selectBackground:() => {selected++;return 'focused';}});
  const start = sessionId => coordinator.startFocus({sessionId,localDate:'2026-10-18',timeBand:'night',timeZone:'Etc/UTC',candidateIds:['focused']},now);
  start('focus-1');
  const disposed=[],loaded=[],attached=[], actor={skeleton:{id:'borrowed'},material:{id:'sourceSkin'},clock:37,prop:{id:'cup'}};
  const pool=createEnvironmentPool({load:async d => {loaded.push(d.id);return load ? load(d) : {id:d.id};},dispose:r=>disposed.push(r)});
  const newSurface=()=>({mounted:[],commit(r,d){this.mounted=d.map(x=>x.id);attached.push(this.mounted);},clear(){this.mounted=[];attached.push([]);}});
  const surface=newSurface(),surfaces=[];
  const makeHost=()=>{const s=surfaces.length?newSurface():surface;surfaces.push(s);return createEnvironmentHost({plan:coordinator.plan,clock:()=>now,descriptors:backgrounds,pool,surface:s});};
  const fact=(sourceId,expiresAt,revision=1,key='theme:coffee')=>coordinator.applySnapshots([{sourceId,generation:1,revision,
    facts:[{id:sourceId,key,observedAt:now,expiresAt}]}],now);
  for (const id of ['routine','feed','detection']) coordinator.setSourceGeneration(id,1,true,now);
  return {coordinator,start,makeHost,pool,surface,surfaces,disposed,loaded,attached,actor,fact,
    setNow:value=>{now=value;},get selected(){return selected;}};
}
export function gate() {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
