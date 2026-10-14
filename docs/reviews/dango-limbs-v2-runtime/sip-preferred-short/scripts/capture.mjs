import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createLifecycleFixture } from './fixture.mjs';

const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const root=path.resolve(arg('repo',process.cwd()));
const out=path.resolve(arg('out',path.join(root,'meta/preferred-sip-lifecycle/evidence')));
fs.mkdirSync(out,{recursive:true});
const fixture=await createLifecycleFixture(root,out,{allowEnabled:process.argv.includes('--allow-enabled')});
const {backend,sources,createRenderHarness}=fixture;
const fps=30,width=1000,height=810,canvas=backend.createCanvas(width,height),ctx=canvas.getContext('2d');
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const gain=p=>smooth(p/.04)*smooth((1-p)/.04);
const hash=b=>createHash('sha256').update(b).digest('hex');
const failures=[],records=[];
function check(value,message){if(!value)failures.push(message);}
let serial=0;
const events=(...items)=>items.map(([at,type,id])=>({at,type,id}));
const scenarios=[
 {id:'full-manual-front',duration:10200,video:true,events:events([600,'action','sip-tea'],[9600,'clear'])},
 {id:'interrupt-reopen-full',duration:17200,video:true,events:events([600,'action','sip-tea'],[3200,'action','wave'],[4200,'action','sip-tea'],[6700,'clear'],[7500,'action','sip-tea'],[16500,'clear'])},
 {id:'pause-resume',duration:11000,pause:[2400,3300],events:events([300,'action','sip-tea'],[9300,'clear'])},
 {id:'reduced-resume',duration:10000,calm:[2000,3200],events:events([300,'action','sip-tea'],[9300,'clear'])},
 {id:'outfit-fallback-reopen',duration:5600,events:events([300,'action','sip-tea'],[2000,'outfit','milestone.scarf'],[3200,'outfit'],[4000,'action','sip-tea'],[5200,'clear'])},
 {id:'hide-reset-resume',duration:11000,pause:[2000,3000],hidden:[2000,3000],events:events([300,'action','sip-tea'],[9300,'clear'])},
 {id:'actual-quarter-handoff',duration:12000,events:events([300,'action','paper-return'],[2300,'action','sip-tea'],[11300,'clear'])}
];
function title(text,x,y,color='#26252a',size=16){ctx.fillStyle=color;ctx.font=`${size}px sans-serif`;ctx.fillText(text,x,y);}
function drawPair(pair,label,t,trace){
 ctx.fillStyle='#eeeae4';ctx.fillRect(0,0,width,height);
 for(const [col,mode]of ['old','integrated'].entries()){
  const x=col*500;
  title(mode==='old'?'Old preferred: forced diagnostic':'Integrated short source',x+16,27);
  title('Actual production renderer | Offscreen Skia',x+16,51,'#65616a',13);
  const h=pair[mode].h;
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(h.body,x+140,63,219,219);
  title('Native design body: 99 CSS px',x+16,293,'#65616a',13);
  ctx.fillStyle='#20232a';ctx.fillRect(x,310,500,470);
  ctx.drawImage(h.body,x+31,324,438,438);
  title('2x design body: 198 CSS px',x+16,765,'#ddd',13);
 }
 title(`${label} | t=${(t/1000).toFixed(2)}s | ${trace.actionId||'idle'} p=${(trace.progress??0).toFixed(4)} | ${trace.view}`,16,803,'#333',13);
}
async function encoder(file){
 const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','-','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',file],{stdio:['pipe','ignore','pipe']});
 let error='';ff.stderr.on('data',b=>error+=b);const exited=once(ff,'close');
 return {async write(){const bytes=Buffer.from(ctx.getImageData(0,0,width,height).data);if(!ff.stdin.write(bytes))await once(ff.stdin,'drain');},
  async close(){ff.stdin.end();const[code]=await exited;if(code!==0)throw Error(error||`ffmpeg exit ${code}`);}};
}
function pixels(h){return Buffer.from(h.body.getContext('2d').getImageData(0,0,h.body.width,h.body.height).data);}
function newPair(){
 const result={};
 for(const mode of ['old','integrated']){
  const options={skin:'pink',outfit:false,dpr:2,view:'front',blink:false,calm:false,
   expressionFor:state=>sources[mode].behaviors.PET_ACTIONS[state.currentEgg?.id]?.expression||'life.idle'};
  const h=createRenderHarness(sources[mode],options);h.select('expression','life.idle');
  h.updateState({devPreview:null,currentEgg:null,appearanceItemIds:[]});
  result[mode]={h,options,control:sources[mode].controls.at(-1)};
 }
 return result;
}
try{
 for(const scenario of scenarios){
  const pair=newPair(),rows=[],video=scenario.video?await encoder(path.join(out,scenario.id+'.mp4')):null;
  let eventIndex=0,hiddenBefore=false,sourceFrames=0,middleExact=0,middleCompared=0,maxCupDelta=0;
  for(let index=0;index<=Math.round(scenario.duration/1000*fps);index++){
   const wall=index/fps*1000;
   const pause=scenario.pause,now=pause?wall-Math.max(0,Math.min(pause[1]-pause[0],wall-pause[0])):wall;
   while(eventIndex<scenario.events.length&&now>=scenario.events[eventIndex].at-1e-7){
    const event=scenario.events[eventIndex++];
    const egg=event.type==='action'?{...sources.old.interactionPlayback.createManualActionPlayback(sources.old.behaviors,event.id,{formId:'dango'}),presentationEventId:`sip-lifecycle.${++serial}`} : null;
    for(const {h}of Object.values(pair)){
     if(event.type==='action')h.updateState({devPreview:null,currentEgg:egg,actionStartedAt:now});
     else if(event.type==='clear')h.updateState({currentEgg:null});
     else if(event.type==='outfit')h.updateState({appearanceItemIds:event.id?[event.id]:[]});
    }
   }
   const hidden=Boolean(scenario.hidden&&wall>=scenario.hidden[0]&&wall<scenario.hidden[1]);
   const calm=Boolean(scenario.calm&&wall>=scenario.calm[0]&&wall<scenario.calm[1]);
   globalThis.document.hidden=hidden;
   for(const {h,options,control}of Object.values(pair)){
    options.calm=calm;h.updateState({sessionPaused:Boolean(pause&&wall>=pause[0]&&wall<pause[1])});
    if(hidden&&!hiddenBefore)control.resetNext=true;
   }
   hiddenBefore=hidden;
   const frames={};for(const mode of ['old','integrated'])frames[mode]=pair[mode].h.draw(now);
   const old=fixture.fixture.traces.old.at(-1),fresh=fixture.fixture.traces.integrated.at(-1);
   check(old.actionId===fresh.actionId&&old.progress===fresh.progress,`${scenario.id}:${index} playback diverged`);
   check(JSON.stringify(old.body)===JSON.stringify(fresh.body),`${scenario.id}:${index} body changed`);
   const active=fresh.source==='sip-front-short-v1';
   if(active){
    sourceFrames++;check(fresh.sourceHands===2,`${scenario.id}:${index} partial source pair`);
    check(Boolean(old.cup&&fresh.cup),`${scenario.id}:${index} missing original cup`);
    const d=Math.hypot(old.cup.x-fresh.cup.x,old.cup.y-fresh.cup.y);maxCupDelta=Math.max(maxCupDelta,d);
    check(d<1e-12,`${scenario.id}:${index} cup moved`);
    for(const h of fresh.hands){const want=[1,0,0,1,fresh.cup.x-23,fresh.cup.y-43];
     check(h.pawMatrix?.every((n,j)=>Math.abs(n-want[j])<1e-12),`${scenario.id}:${index} source transformed`);}
    const opacity=fresh.recovery===null?gain(fresh.progress):1;
    check(Math.abs((fresh.cup.opacity??1)-(old.cup.opacity??1)*opacity)<1e-10,`${scenario.id}:${index} cup gain mismatch`);
    for(const h of fresh.hands){const before=old.hands.find(v=>v.side===h.side);
     check(Math.abs(h.opacity-before.opacity*opacity)<1e-10,`${scenario.id}:${index} hand gain mismatch`);}
    if(fresh.progress>=.04&&fresh.progress<=.96&&fresh.recovery===null){middleCompared++;
     if(Buffer.compare(pixels(pair.old.h),pixels(pair.integrated.h))===0)middleExact++;
     else failures.push(`${scenario.id}:${index} middle rendered pixels differ from original preferred source`);}
   }
   if(!fresh.actionId)check(!active&&fresh.sourceHands===0&&fresh.cup===null,`${scenario.id}:${index} idle leaked source or cup`);
   if(scenario.id==='full-manual-front'&&fresh.actionId==='sip-tea')check(active,`${scenario.id}:${index} source fallback during lifecycle`);
   if(scenario.id==='actual-quarter-handoff'&&fresh.actionId==='sip-tea')check(fresh.view==='three-quarter'&&!active,`${scenario.id}:${index} handoff view changed`);
   const row={index,wallTimeMs:wall,animationTimeMs:now,hidden,calm,requested:frames.integrated.state.currentEgg?.id||null,
    observed:frames.integrated.state.currentActionProgress,old,fresh};rows.push(row);
   if(video||index%30===0){drawPair(pair,scenario.id,wall,fresh);if(video)await video.write();}
   const landmarks=scenario.id==='full-manual-front'?[0,600,700,800,966.666667,2100,3666.666667,5100,7600,9266.666667,9400,9500,9566.666667,9600,10200]
    :scenario.id==='interrupt-reopen-full'?[600,3166.666667,3200,4200,4500,6666.666667,6700,7500,16500]
    :[0,300,2000,2400,3000,3200,4000,5200,scenario.duration];
   if(landmarks.some(t=>Math.abs(wall-t)<.001)){drawPair(pair,scenario.id,wall,fresh);
    fs.writeFileSync(path.join(out,`${scenario.id}-${String(Math.round(wall)).padStart(5,'0')}.png`),canvas.toBuffer('image/png'));}
   if(index%90===0)await new Promise(resolve=>setImmediate(resolve));
  }
  if(video)await video.close();
  for(const {h}of Object.values(pair))h.dispose();
  fs.writeFileSync(path.join(out,scenario.id+'-frames.json'),JSON.stringify(rows,null,2)+'\n');
  const record={id:scenario.id,frames:rows.length,sourceFrames,middleCompared,middleExact,maxCupCoordinateDelta:maxCupDelta,
   video:scenario.video?scenario.id+'.mp4':null,fullManual:true,preview:false,
   finalObserved:rows.at(-1).fresh,elapsedMs:scenario.duration};records.push(record);
  console.log(JSON.stringify({scenario:scenario.id,frames:rows.length,sourceFrames,middleCompared,middleExact,failures:failures.length}));
 }
 const report={status:failures.length?'failed':'passed',backend:'Actual createPetRenderer with two injected standard artists; offscreen Skia only, not native desktop/GPU/browser acceptance',
  fixture:'Manual playback records from production createManualActionPlayback; one renderer and continuous clock per scenario. Host fixture clears eggs at their deadline or explicit cancellation. No devPreview action loop.',
  comparison:'Left: original preferred sip-front-v1 pixels through a forced diagnostic limbPainter with original timing. Right: closed sip-front-short-v1 selector with two in-memory enabled flags and shared 4% entry/exit opacity envelope.',
  visibilityScope:'hide-reset-resume calls actual renderer clearDecorativeParticles then repeats the paused animation clock. It is a host-command replay, not a real OS visibility event.',
  unsupportedScope:'View changes are represented by the actual inherited three-quarter paper-return handoff. No artificial manual front-to-quarter transform was added.',
  productionGateState:fixture.productionGateState,keys:fixture.keys,fps,videoSize:[width,height],dpr:2,records,failures,
  sourceHashes:Object.fromEntries(['src/surfaces/pet/renderer.mjs','src/surfaces/pet/action-playback.mjs','src/capabilities/companion/presentation/form-art.mjs','src/capabilities/companion/presentation/dango-sip-short-contact-pose.mjs','src/capabilities/companion/presentation/dango-source-contact-pose.mjs'].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]))};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,failures:failures.slice(0,20),scenarios:records.length}));
 if(failures.length)process.exitCode=1;
}finally{fixture.dispose();globalThis.document.hidden=false;}
