// Isolated fixture adapter only: no production imports or capability admission.
import { createTopologyOracle } from './oracle.mjs';
const DISPLAY = ['display-added', 'display-removed', 'display-metrics-changed'];
const POWER = ['suspend', 'lock-screen', 'resume', 'unlock-screen'];
export function createFixtureTopologyAdapter({ app, screen, powerMonitor, onSnapshot = () => {} }) {
 const oracle=createTopologyOracle(); let listeners=[];
 let cleanupDepth=0;
 let phase='waiting', readyObserved=false, refreshing=false, dirty=false, suspended=false, locked=false;
 let latest={accepted:false,reason:'app-not-ready',productionCapability:false};
 const report=value=>{latest=structuredClone(value);try{onSnapshot(structuredClone(latest));}catch{/* observer never grants authority */}};
 function cleanup(){
  cleanupDepth++;
  const batch=listeners;listeners=[];const remaining=[];
  try{for(const entry of batch){const [source,event,handler]=entry;try{source.removeListener(event,handler);}catch{remaining.push(entry);}}}
  finally{listeners.push(...remaining);cleanupDepth--;}
 }
 function refresh(){
  if(phase!=='active'||suspended||locked)return;
  if(refreshing){dirty=true;return;}refreshing=true;
  try{let passes=0;do{
   dirty=false;const ticket=oracle.beginEnumeration();let displays;
   try{displays=screen.getAllDisplays();}catch{displays=null;}
   const result=oracle.observe(displays,ticket);
   if(phase==='active'&&!suspended&&!locked&&result.reason!=='stale-enumeration')report(result);
   passes++;
  }while(dirty&&phase==='active'&&!suspended&&!locked&&passes<4);
  }finally{refreshing=false;}
 }
 function changed(event){
  if(phase!=='active'&&phase!=='starting')return;
  const revoked=oracle.invalidateEvent(event);
  if(event==='suspend')suspended=true;if(event==='resume')suspended=false;
  if(event==='lock-screen')locked=true;if(event==='unlock-screen')locked=false;
  report({...revoked,accepted:false,reason:'revoked-awaiting-enumeration'});
  refresh(); // starting is deliberately not active.
 }
 function start(){
  if(!readyObserved||cleanupDepth>0||!['waiting','failed'].includes(phase))return;
  phase='starting'; // Own initialization before cleanup can invoke external code.
  cleanup();
  if(phase==='closed'){if(listeners.length)report({accepted:false,reason:'adapter-disposed-cleanup-unverified',productionCapability:false});return;}
  if(listeners.length){phase='failed';report({accepted:false,reason:'subscription-cleanup-unverified',productionCapability:false});return;}
  phase='starting';
  try{
   for(const [source,events]of [[screen,DISPLAY],[powerMonitor,POWER]])for(const event of events){
    if(phase!=='starting')throw Error('initialization-cancelled');
    const handler=()=>changed(event);
    // Track before .on: an injected source may subscribe and then throw.
    listeners.push([source,event,handler]);source.on(event,handler);
   }
   if(phase!=='starting')throw Error('initialization-cancelled');
   phase='active';refresh();
  }catch{
   if(phase!=='closed')phase='rolling-back';
   cleanup();
   if(phase==='closed'){if(listeners.length)report({accepted:false,reason:'adapter-disposed-cleanup-unverified',productionCapability:false});return;}
   phase='failed';report({accepted:false,reason:listeners.length?'subscription-cleanup-unverified':'subscription-failed',productionCapability:false});
  }
 }
 function ready(){readyObserved=true;start();}
 app.once('ready',ready);if(app.isReady())ready();
 return Object.freeze({
  snapshot:()=>structuredClone(latest),refresh,retryStart:start,
  commitSegment(...args){
   if(phase!=='active'||suspended||locked)return{accepted:false,reason:'adapter-not-active'};
   const epoch=latest.epoch,revision=latest.revision;
   let from,to;
   try{from={x:args[0]?.x,y:args[0]?.y};to={x:args[1]?.x,y:args[1]?.y};}
   catch{return{accepted:false,reason:'invalid-point-read'};}
   if(phase!=='active'||suspended||locked)return{accepted:false,reason:'adapter-not-active'};
   if(latest.epoch!==epoch||latest.revision!==revision)return{accepted:false,reason:'adapter-context-changed'};
   const result=oracle.commitSegment(from,to,args[2],args[3]);
   // Caller-owned point getters can synchronously dispose or deliver an event.
   if(phase!=='active'||suspended||locked)return{accepted:false,reason:'adapter-not-active'};
   if(latest.epoch!==epoch||latest.revision!==revision)return{accepted:false,reason:'adapter-context-changed'};
   return result;
  },
  dispose(){
   phase='closed';report({accepted:false,reason:'adapter-disposed',productionCapability:false});
   try{app.removeListener('ready',ready);}catch{/* cannot activate after closed */}
   cleanup();
   if(listeners.length)report({accepted:false,reason:'adapter-disposed-cleanup-unverified',productionCapability:false});
  }
 });
}
