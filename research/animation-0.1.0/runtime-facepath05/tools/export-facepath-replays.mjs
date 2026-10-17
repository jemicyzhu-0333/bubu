import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepareFacePack,sha256} from '../src/pack-loader.mjs';
import {FaceTimeline} from '../src/face-timeline.mjs';
import {ActorPool} from '../src/actor-pool.mjs';
import {localPackReader} from './read-local-pack.mjs';
import {FACEPATH_SCENARIOS} from './facepath-scenarios.mjs';
const root=new URL('../',import.meta.url),folder=new URL('evidence/facepath-replays/',root),fps=30;
await mkdir(folder,{recursive:true});
const pack=await prepareFacePack(localPackReader(fileURLToPath(new URL('fixtures/face-slice7/',root))));
const timelineHash=await sha256(await readFile(new URL('src/face-timeline.mjs',root)));
const manifests=[];
function stateAt(scenario,time){const clock=new FaceTimeline(pack.profile.paths.map(p=>p.id),()=>{});for(const event of scenario.events){if(event.time>time)break;clock.advance(event.time);clock.enqueue(event);clock.advance(event.time);}clock.advance(time);return clock.snapshot();}
function snapshot(actor,frame,time,meshes){
 actor.assertCurrent();const weights={};for(const [name,index]of Object.entries(meshes[0].morphTargetDictionary))if(meshes[0].morphTargetInfluences[index]!==0)weights[name]=meshes[0].morphTargetInfluences[index];
 for(const mesh of meshes)for(const [name,index]of Object.entries(mesh.morphTargetDictionary))if(mesh.morphTargetInfluences[index]!== (weights[name]??0))throw Error('Layer mapper divergence');
 return {frame,time,state:actor.state,weights};
}
for(const [name,scenario]of Object.entries(FACEPATH_SCENARIOS)) {
 const pool=new ActorPool(),actor=await pool.create(pack),frames=[];let next=0;
 try {
  const meshes=pack.profile.faceMeshes.map(n=>actor.root.getObjectByName(n));
  for(let f=0;f<=Math.round(scenario.duration*fps);f++) {
   const time=f/fps;
   while(next<scenario.events.length&&scenario.events[next].time<=time) {
    const event=scenario.events[next++];actor.advance(event.time);actor.enqueue(event);actor.advance(event.time);
   }
   actor.advance(time);frames.push(snapshot(actor,f,time,meshes));
  }
  const times=new Map(),add=(time,label)=>{if(!Number.isFinite(time)||time<0||time>scenario.duration)return;let labels=times.get(time);if(!labels)times.set(time,labels=[]);if(!labels.includes(label))labels.push(label);};
  for(const event of scenario.events)for(const offset of [-1e-6,0,1e-6])add(event.time+offset,'event'+(offset<0?'-':offset>0?'+':''));
  for(const frame of frames)for(const key of ['arrivalTime','neutralAt','segmentEndsAt','brakeEndsAt','actualArrival'])add(frame.state[key],key);
  for(let i=1;i<frames.length;i++){const a=frames[i-1],b=frames[i];if(a.state.path==='N3'&&b.state.path==='N3'&&(a.state.value-.5)*(b.state.value-.5)<0){let lo=a.time,hi=b.time;const increasing=b.state.value>a.state.value;for(let n=0;n<45;n++){const mid=(lo+hi)/2,v=stateAt(scenario,mid).value;if((v<.5)===increasing)lo=mid;else hi=mid;}add((lo+hi)/2,'N3-half-crossing');}}
  const diagnosticActor=await pool.create(pack),diagnostics=[];let di=0;
  try{const dm=pack.profile.faceMeshes.map(n=>diagnosticActor.root.getObjectByName(n));for(const time of [...times.keys()].sort((a,b)=>a-b)){while(di<scenario.events.length&&scenario.events[di].time<=time){const event=scenario.events[di++];diagnosticActor.advance(event.time);diagnosticActor.enqueue(event);diagnosticActor.advance(event.time);}diagnosticActor.advance(time);diagnostics.push({...snapshot(diagnosticActor,null,time,dm),labels:times.get(time)});}}finally{diagnosticActor.dispose();}

  const replay={format:'bubu-facepath-replay',version:'0.1.0',name,scope:'Actual face-suite scalar state and eight-layer influences; static source skeleton; offline renderer replay, not WebGL capture',assetSha256:pack.profile.sourceSha256,timelineSha256:timelineHash,fps,duration:scenario.duration,faceRoster:pack.profile.faceMeshes,events:scenario.events,frames,diagnostics};
  const bytes=new TextEncoder().encode(JSON.stringify(replay,null,2)+'\n');await writeFile(new URL(name+'.json',folder),bytes);
  manifests.push({name,frames:frames.length,diagnostics:diagnostics.length,fps,duration:scenario.duration,sha256:await sha256(bytes)});
 }finally{actor.dispose();pool.dispose();if(pool.stats.actors||pool.stats.sourceBytes)throw Error('Outstanding ownership');}
}
await writeFile(new URL('manifest.json',folder),JSON.stringify({assetSha256:pack.profile.sourceSha256,timelineSha256:timelineHash,replays:manifests},null,2)+'\n');
console.log(JSON.stringify(manifests));
