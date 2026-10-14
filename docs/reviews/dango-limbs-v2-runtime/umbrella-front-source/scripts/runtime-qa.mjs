import fs from 'node:fs';import path from 'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{fixture}from'./fixture.mjs';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const root=path.resolve(arg('repo',path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../..'))),out=path.resolve(arg('out',path.join(root,'meta/umbrella-front-source-qa/runtime'))),images=process.argv.includes('--images');fs.mkdirSync(out,{recursive:true});
const {umbrellaSourceContactPoseEligible,applyUmbrellaSourceContactPose}=await import(pathToFileURL(path.join(root,'src/capabilities/companion/presentation/dango-umbrella-contact-pose.mjs')).href);
const {DANGO_RASTER}=await import(pathToFileURL(path.join(root,'assets/companion/dango/raster/dango.raster.mjs')).href);
const entries=Object.fromEntries(Object.entries(DANGO_RASTER.tools).filter(([key])=>key.startsWith('umbrella-front-v1-')));
const candidate=async({backend,limbs,manifest,createArtist,trace})=>{
 const m=structuredClone(manifest);Object.assign(m.tools,entries);
 const a=createArtist({manifest:m,limbs,createSurface:backend.createCanvas,loadImage:u=>backend.loadImage(fileURLToPath(u))});
 return{...a,resolveArtwork(o){let art=a.resolveArtwork(o);if(umbrellaSourceContactPoseEligible(m,art,art.view,o))art=applyUmbrellaSourceContactPose(m,art,o);trace(o,art);return art;}};
};
const f=await fixture(root,out,{candidate}),rows=[],failures=[],sha=buf=>createHash('sha256').update(buf).digest('hex');
const sheets=[];
for(const dpr of[1,1.25,1.5,2,3])for(const facing of[1,-1])for(const calm of[false,true]){
 const pair={};for(const mode of['legacy','candidate']){const h=f.createRenderHarness(f.sources[mode],{skin:'pink',outfit:false,dpr,view:'front',facing,calm,blink:false});h.select('action','umbrella-dance');pair[mode]=h;}
 let count=0;
 for(let i=0;i<=100;i++){
  const at=i*100;
  for(const mode of['legacy','candidate'])pair[mode].draw(at);
  const old=f.traces.legacy.at(-1),fresh=f.traces.candidate.at(-1),art=fresh.art;
  const fail=s=>failures.push(`${dpr}/${facing}/${calm}/${i}: ${s}`);
  if(art.view!=='front')fail('front changed');
  if(art.sourceContactPose!=='umbrella-front-v1')fail('source not selected');
  if(JSON.stringify(old.art.data.body)!==JSON.stringify(art.data.body))fail('body asset changed');
  const prop=old.art.contact.tools.find(t=>t.key==='umbrella'),parts=art.contact.tools.filter(t=>t.key.startsWith('umbrella-front-v1-'));
  if(parts.length!==2||parts.some(t=>t.x!==prop.x||t.y!==prop.y))fail('prop source location changed');
  const hand=art.contact.hands[0];if(hand.limb||hand.connector||hand.attachedArm)fail('generic fore was retained');
  if(JSON.stringify(hand.pawMatrix)!=='[1,0,0,1,0,0]')fail('source hand transform drift');
  const ctx=pair.candidate.body.getContext('2d'),px=ctx.getImageData(0,0,pair.candidate.body.width,pair.candidate.body.height).data;
  if(!px.some((n,k)=>k%4===3&&n))fail('empty frame');
  if(images&&dpr===2&&facing===1&&!calm&&[0,12,25,37,50,62,75,87,100].includes(i)){
   const file=`p${String(i).padStart(3,'0')}.png`;fs.writeFileSync(path.join(out,file),pair.candidate.body.toBuffer('image/png'));sheets.push({i,file});
  }
  count++;
 }
 rows.push({dpr,facing,calm,frames:count,bodyAssetUnchanged:true,propCoordinatesUnchanged:true,grip:[61.875,35.75],forearm:'not present in continuous short-source pose'});
}
const w=3*670,h=3*940,can=f.backend.createCanvas(w,h),ctx=can.getContext('2d');
for(let n=0;n<sheets.length;n++){
 const {i,file}=sheets[n],im=await f.backend.loadImage(path.join(out,file)),x=n%3*670,y=Math.floor(n/3)*940;
 ctx.fillStyle='#f5f1e9';ctx.fillRect(x,y,670,470);ctx.fillStyle='#252735';ctx.fillRect(x,y+470,670,470);
 for(const off of[0,470]){ctx.imageSmoothingEnabled=false;ctx.drawImage(im,x+5,y+off+100,219,219);ctx.drawImage(im,x+227,y+off+26,438,438);ctx.fillStyle=off?'#eee':'#333';ctx.font='14px sans-serif';ctx.fillText(`p=${(i/100).toFixed(2)} | 99 CSS px native body + 198 CSS px 2x body`,x+8,y+off+19);}
}
if(images)fs.writeFileSync(path.join(out,'phase-extremes-light-dark.png'),can.toBuffer('image/png'));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({evidence:'Actual production renderer and raster painter through test-only source selection injection. Offscreen Skia; not native desktop QA.',dprs:[1,1.25,1.5,2,3],facings:[1,-1],calmModes:[false,true],phases:101,total:rows.reduce((s,r)=>s+r.frames,0),failures,cache:f.artists.candidate.cacheStats()},null,2));console.log(JSON.stringify({total:rows.reduce((s,r)=>s+r.frames,0),failures,output:out}));f.dispose();
