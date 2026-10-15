import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {loadSource,createRenderHarness} from '../usagi-gallery/runtime-harness.mjs';
import {FRONT_STORY_ASSETS as A} from '../../assets/companion/dango/front-stories/assets.mjs';
import {createSessionActivityController} from '../../src/core/session-activity.mjs';
import {MIRROR_ACTIVITIES,MIRROR_ROTATIONS} from '../../src/content/session-activities.mjs';
const backend=createRequire(import.meta.url)('@napi-rs/canvas');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.split('=').slice(1).join('=');
const dense=process.argv.includes('--dense'),dpr=Number(arg('dpr')||2),facing=Number(arg('facing')||1);
if(![1,1.25,1.5,2].includes(dpr)||![1,-1].includes(facing))throw Error('unsupported diagnostic scale/facing');
const omit=arg('omit')||'',failure=arg('failure')||'',label=(omit?'omit-'+omit:failure?'fail-'+failure:'actual')+(dense?'-dense':'')+((arg('dpr')||arg('facing'))?`-dpr${dpr}-facing${facing}`:'');
const paths=Object.fromEntries(Object.entries(A.sprites).map(([k,s])=>[k,fileURLToPath(new URL(s.src,A.baseUrl))]));
paths.feet='/views/front/foot-';
const matches=(url,key)=>key&&(key==='feet'?url.pathname.includes(paths.feet):fileURLToPath(url)===paths[key]);
const ledger=new Map();
globalThis.Image=class extends backend.Image{
 get src(){return this.localSource||'';}
 set src(value){this.localSource=value;if(!value)return;const url=new URL(value);const key=Object.keys(paths).find(k=>matches(url,k));
  if(key)ledger.set(key,{requested:true,loaded:false,drawCount:0,url:value});
  if(matches(url,failure)){queueMicrotask(()=>this.onerror?.(Error('injected group failure')));return;}
  const data=fs.readFileSync(fileURLToPath(url));
  if(matches(url,omit)){const raw=new backend.Image();raw.src=data;super.src=backend.createCanvas(raw.width,raw.height).toBuffer('image/png');}
  else super.src=data;
  if(key)ledger.get(key).loaded=true;
 }
};
const prototype=Object.getPrototypeOf(backend.createCanvas(1,1).getContext('2d')),draw=prototype.drawImage;
prototype.drawImage=function(im,...args){if(im?.localSource){const url=new URL(im.localSource);const key=Object.keys(paths).find(k=>matches(url,k));if(key&&ledger.has(key))ledger.get(key).drawCount++;}return draw.call(this,im,...args);};
globalThis.Path2D=backend.Path2D;globalThis.document={createElement:()=>backend.createCanvas(1,1)};globalThis.window={devicePixelRatio:2};
const source=await loadSource(new URL('../../',import.meta.url).href.replace(/\/$/,''));
const out=new URL('../../../evidence-production/'+label+'/',import.meta.url);fs.mkdirSync(out,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex'),records=[];
function capture(h,name,at){for(const item of ledger.values())item.drawCount=0;const frame=h.draw(at);const png=h.body.toBuffer('image/png');fs.writeFileSync(new URL(name+'.png',out),png);
 const input={name,at,state:frame.state.state,view:frame.state.devPreview?.view,appearance:frame.state.appearanceItemIds,mirror:frame.mirrorPlayback};
 records.push({name,at,poseSha256:hash(JSON.stringify({...input,progress:frame.state.currentActionProgress,dpr,facing})),inputSha256:hash(JSON.stringify(input)),pngSha256:hash(png),resources:Object.fromEntries([...ledger].map(([k,v])=>[k,{...v,selected:v.drawCount>0}]))});}
for(const dressed of [false,true])for(const view of ['front','three-quarter']){
 const outfit=dressed?['seasonal.pumpkin-beret','seasonal.plum-cape']:[];
 const h=createRenderHarness(source,{skin:'pink',view,dpr, facing,blink:false,outfit});h.select('action','halloween-lantern');
 for(const at of [0,1000,2400,3800,5700,6800,7199])capture(h,`halloween-${dressed?'dressed':'bare'}-${view}-${at}`,at);
 h.updateState({devPreview:null,currentEgg:null});capture(h,`halloween-${dressed?'dressed':'bare'}-${view}-off`,7400);h.dispose();
}
source.sessions={...source.sessions,SESSION_ACTIVITIES:{...source.sessions.SESSION_ACTIVITIES,...MIRROR_ACTIVITIES}};
for(const view of ['front','three-quarter']){
 const controller=createSessionActivityController({activities:MIRROR_ACTIVITIES,rotations:MIRROR_ROTATIONS,clock:{now:()=>0}});
 controller.setMode('mirror-ai',0);const h=createRenderHarness(source,{skin:'pink',view,dpr, facing,blink:false,outfit:[],sessionActivityController:controller});h.select(view==='front'?'expression':'session',view==='front'?'life.attentive':'mirror-ai');h.updateState({devPreview:view==='front'?null:{category:'session',id:'mirror-ai',view},state:'idle',sessionState:'idle'});
 for(const at of [0,1000,2400,5700,125000])capture(h,`ai-${view}-${at}`,at);
 controller.setMode('idle',125001);h.updateState({state:'idle',sessionState:'idle',devPreview:null,currentEgg:null});
 for(const at of [125001,125301,125601])capture(h,`ai-${view}-${at}`,at);h.dispose();
}
if(dense){const h=createRenderHarness(source,{skin:'pink',view:'front',dpr, facing,blink:false,outfit:['seasonal.pumpkin-beret','seasonal.plum-cape']});h.select('action','halloween-lantern');for(let at=0;at<7200;at+=100)capture(h,`dense-front-${at}`,at);h.dispose();}
fs.writeFileSync(new URL('records.json',out),JSON.stringify({label,omit,failure,records},null,2));console.log(label,records.length);
