// Finite host replay through createPetRenderer, with transparent PNGs and
// frame-index hashes. This is diagnostic offscreen Canvas, never native QA.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { installOffscreenImages } from '../usagi-gallery/offscreen-images.mjs';
import { loadSource,createRenderHarness } from '../usagi-gallery/runtime-harness.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const out=path.resolve(arg('out',path.join(root,'dist/motion-lifecycle')));fs.mkdirSync(out,{recursive:true});
const backend=createRequire(import.meta.url)(arg('canvas-package',path.join(root,'node_modules/@napi-rs/canvas')));
installOffscreenImages(backend);globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(pathToFileURL(root).href);
const sourceSeal=JSON.parse(fs.readFileSync(arg('seal'),'utf8'));
const outfits={pink:['milestone.sunhat','milestone.scarf','milestone.satchel','milestone.cape','milestone.boots'],
 usagi:['usagi.moon-beret','usagi.paper-plane-clip','usagi.star-collar','usagi.starlit-cape','usagi.envelope-pouch','usagi.constellation','usagi.moon-boots']};
const cases=[{id:'complete',end:11800},{id:'interrupt-hold',cut:2500,end:4700},
 {id:'interrupt-flight',cut:5500,end:7700},{id:'interrupt-catch',cut:7750,end:9950},
 {id:'reduced-midflight',calmAt:5000,resumeAt:7500,end:11800},
 {id:'pause-resume',pauseAt:4300,pauseFor:900,end:12700}];
const index={surface:'offscreen-skia-production-renderer',sourceSeal:sourceSeal.seal,baseCommit:sourceSeal.baseCommit,
 toolSha256:crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
 dpr:2,bodyWidthCss:99,stageCss:219,fps:30,cases:[],limitations:['No native desktop/GPU or memory signoff.',
 'Host clock pause is replayed by repeated equal animation time; no real user profile or OS event is used.',
 'Visibility/occlusion requires pixel review; action labels alone do not prove visible equipment.']};
for(const skin of ['pink','usagi'])for(const dressed of [false,true])for(const scenario of cases){
 const name=`${skin}-${dressed?'dressed':'bare'}-${scenario.id}`,dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});
 const options={skin,dpr:2,view:'three-quarter',blink:false,outfit:dressed?outfits[skin]:[],calm:false};
 const h=createRenderHarness(source,options);h.select('expression','life.idle');
 const entry={name,skin,outfit:options.outfit,scenario,frames:[]};let began=false,interrupted=false,finished=false,settled=false;
 const samples=[...new Set([...Array.from({length:Math.floor(scenario.end/1000*30)+1},(_,i)=>i/30*1000),
 ...[0,840,1470,3570-1000/30,3570,3570+1000/30,7350,7980-1000/30,7980,7980+1000/30,8820,10080,10500].map(v=>v+600).filter(v=>v<=scenario.end)])].sort((a,b)=>a-b);
 for(const [n,timeMs] of samples.entries()){
  let now=timeMs;
  if(scenario.pauseAt&&timeMs>=scenario.pauseAt)now-=Math.min(scenario.pauseFor,timeMs-scenario.pauseAt);
  if(now>=600&&!began){h.select('action','paper-return');h.updateState({devPreview:null,actionStartedAt:600});began=true;}
  if(scenario.cut&&now>=600+scenario.cut&&!interrupted){h.select('action','sip-tea');h.updateState({devPreview:null,actionStartedAt:now});interrupted=true;}
  if(interrupted&&now>=600+scenario.cut+500&&!settled){h.select('expression','life.idle');settled=true;}
  if(!scenario.cut&&now>=11100&&!finished){h.select('expression','life.idle');finished=true;}
  if(scenario.calmAt)options.calm=now>=scenario.calmAt&&now<scenario.resumeAt;
  const before=performance.now(),frame=h.draw(now),renderMs=performance.now()-before;
  const bytes=h.body.toBuffer('image/png'),file=`${String(n).padStart(4,'0')}.png`;fs.writeFileSync(path.join(dir,file),bytes);
  entry.frames.push({index:n,timeMs,animationTimeMs:now,actionElapsedMs:now-600,action:frame.state.currentRenderedAction?.id||null,
   calm:options.calm,file:`${name}/${file}`,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
   width:h.body.width,height:h.body.height,renderMs});
 }
 h.dispose();index.cases.push(entry);fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(index,null,2));console.log(`${name}: ${entry.frames.length} transparent frames`);
}
