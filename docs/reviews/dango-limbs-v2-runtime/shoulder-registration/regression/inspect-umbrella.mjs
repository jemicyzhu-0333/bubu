// Read-only actual-artist contact regression. No source writes; only one supplied root.
// Usage: node compare.mjs --repo REPO --out OUTPUT_DIR [--steps 1024]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {registeredComparisonSources,cliOptions} from './registration-sources.mjs';
const options=cliOptions(process.argv.slice(2));
const root=path.resolve(options.repo),out=path.resolve(options.out),steps=options.steps;
fs.mkdirSync(out,{recursive:true});
const imp=p=>import(pathToFileURL(path.join(root,p)));
const {createCanvas,loadImage}=createRequire(root+'/package.json')('@napi-rs/canvas');
const {loadLimbSource}=await imp('tools/dango-limbs-qa.mjs');
const {contactContract,solveLimb,createDangoLimbPainter,pawLayer,composeLimb,DANGO_LIMB_BOX:box}=await imp('src/capabilities/companion/presentation/dango-limb-compose.mjs');
const {DANGO_RASTER:manifest}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {DANGO_ACTION_VIEWS:views}=await imp('src/content/companion/dango-action-views.mjs');
const {PET_ACTIONS:actions}=await imp('src/content/behaviors.mjs');
const {DANGO_LIMB_RIG:rig}=await imp('src/content/companion/dango-limbs.mjs');
const {createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const source=await loadLimbSource();assert.equal(source.state(),'ready');
const {before,after,inputSnapshot,inputRoot}=registeredComparisonSources(source);
const oldManifest=before.manifest(),nextManifest=after.manifest();
const socket=nextManifest.sockets.find(s=>s.kind==='shoulder'&&s.view==='front'&&s.side==='r');
const variants=await Promise.all([['before',before],['after',after]].map(async([name,src])=>{
  const artist=createDangoRasterArtist({manifest,limbs:src,loadImage:u=>loadImage(fileURLToPath(u)),createSurface:createCanvas});
  await artist.ready({all:true});return {name,src,artist,painter:createDangoLimbPainter({source:src,createSurface:createCanvas}),exposure:new Map()};
}));


const {PALETTES}=await imp('src/core/pet-art.mjs');
const action=actions['umbrella-dance'],phases=[0,.125,.5,.875,1],records=[];
const sheet=createCanvas(1500,480),ctx=sheet.getContext('2d');ctx.fillStyle='#e9e7df';ctx.fillRect(0,0,1500,480);ctx.imageSmoothingEnabled=false;
for(const [i,v]of variants.entries())for(const [j,progress]of phases.entries()){
 const z=v.artist.resolveArtwork({action,motion:action.motion,view:'front',progress,elapsedMs:progress*action.duration});
 const hand=z.contact.hands.find(h=>h.side==='right'),ct=contactContract(hand,action),plan=v.painter.plan(z.view,hand,action),c=composeLimb(v.src,plan);let exposed=[];
 for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){const k=(y*box.w+x)*4+3;if(c.arm.data[k]&&!v.src.bodyAlpha(plan.view,x+box.x+.5,y+box.y+.5)&&!c.paw.data[k])exposed.push([x+box.x,y+box.y]);}
 records.push({variant:v.name,phase:progress,standard:hand.limb===true,S:plan.S,E:plan.E,W:plan.W,target:ct.target,contact:plan.contactWorld,error:plan.error,upperAngle:plan.joint.upperAngle,foreAngle:plan.joint.foreAngle,paw:plan.paw.src,exposed,tools:z.contact.tools});
 const canvas=createCanvas(98,104),x=canvas.getContext('2d');x.translate(16,30);const o={action,artwork:z,palette:PALETTES.pink,view:z.view,progress};v.artist.action(x,{...o,layer:'back'});v.artist.body(x,PALETTES.pink,z.view,z);v.artist.face(x,PALETTES.pink,{},false,z.view,null,z);v.artist.action(x,{...o,layer:'front'});
 ctx.drawImage(canvas,j*300,i*240+30);ctx.drawImage(canvas,j*300+100,i*240+24,196,208);ctx.fillStyle='#222';ctx.font='12px sans-serif';ctx.fillText(v.name+' p='+progress+'; standard='+(hand.limb===true),j*300+5,i*240+15);
}
for(const v of variants){v.artist.dispose();v.painter.dispose();}
fs.writeFileSync(path.join(out,'umbrella-five-phases-1x-2x.png'),sheet.toBuffer('image/png'));fs.writeFileSync(path.join(out,'umbrella-plans.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records.map(({exposed,tools,...r})=>({...r,exposed:exposed.length})),null,2));
