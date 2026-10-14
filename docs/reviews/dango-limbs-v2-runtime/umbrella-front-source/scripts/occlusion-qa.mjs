import fs from'node:fs';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{createCanvas,loadImage}from'@napi-rs/canvas';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const root=path.resolve(arg('repo',path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../..'))),out=path.resolve(arg('out',path.join(root,'meta/umbrella-front-source-qa/occlusion'))),images=process.argv.includes('--images');fs.mkdirSync(out,{recursive:true});
const imp=p=>import(pathToFileURL(path.join(root,p)).href);
const {DANGO_RASTER:manifest}=await imp('assets/companion/dango/raster/dango.raster.mjs');
const {createDangoRasterArtist}=await imp('src/capabilities/companion/presentation/dango-raster-art.mjs');
const {PET_APPEARANCE_ITEMS}=await imp('src/content/appearance.mjs');
const {PET_ACTIONS}=await imp('src/content/behaviors.mjs');
const {PALETTES}=await imp('src/core/pet-art.mjs');
const a=createDangoRasterArtist({manifest,createSurface:createCanvas,loadImage:u=>loadImage(fileURLToPath(u))});await a.ready({all:true});
const S=8,W=768,offset=12,c=createCanvas(W,W),ctx=c.getContext('2d'),front=await loadImage(path.join(root,'assets/companion/dango/raster/action-contact/umbrella-front-v1/umbrella-front.png')),hand=await loadImage(path.join(root,'assets/companion/dango/raster/action-contact/umbrella-front-v1/right-8x.png'));
const blank=()=>{ctx.resetTransform();ctx.clearRect(0,0,W,W);ctx.setTransform(S,0,0,S,offset*S,offset*S);ctx.imageSmoothingEnabled=false;};
blank();ctx.drawImage(front,37,-11,50,66);const fp=ctx.getImageData(0,0,W,W).data;const foreground=[];for(let i=3;i<fp.length;i+=4)if(fp[i])foreground.push(i);
blank();ctx.drawImage(hand,0,0,72,72);ctx.drawImage(front,37,-11,50,66);const hp=ctx.getImageData(0,0,W,W).data;const all=[];for(let i=3;i<hp.length;i+=4)if(hp[i])all.push(i);
const scan=indices=>{const px=ctx.getImageData(0,0,W,W).data;let n=0;for(const i of indices)if(px[i])n++;return n;};
const faces=[],headwear=[];
for(let i=0;i<=100;i++){
 const p=i/100,o={view:'front',action:PET_ACTIONS['umbrella-dance'],motion:'umbrella',progress:p,elapsedMs:p*10000,appearance:{items:[]}},art=a.resolveArtwork(o);
 blank();a.face(ctx,PALETTES.pink,{},false,'front',null,art);faces.push({p,foregroundShaftFaceOverlap:scan(foreground),sourceHandAndShaftFaceOverlap:scan(all)});
}
for(const item of PET_APPEARANCE_ITEMS.filter(i=>(i.formId||'dango')==='dango'&&i.slot==='head'))for(const p of[0,.25,.5,.75,1]){
 const appearance={items:[item]},o={view:'front',action:PET_ACTIONS['umbrella-dance'],motion:'umbrella',progress:p,elapsedMs:p*10000,appearance},art=a.resolveArtwork(o);blank();
 for(const layer of['back','front'])a.appearance(ctx,{...o,artwork:art,item,appearance,palette:PALETTES.pink,layer});
 headwear.push({id:item.id,p,foregroundShaftHeadwearOverlap:scan(foreground),sourceHandAndShaftHeadwearOverlap:scan(all)});
}
const paletteRows=[];let baselineAlpha=null;
for(const [skin,palette]of Object.entries(PALETTES)){
 const o={view:'front',action:PET_ACTIONS['umbrella-dance'],motion:'umbrella',progress:.5,elapsedMs:5000,appearance:{items:[]}},art=a.resolveArtwork(o);blank();a.action(ctx,{...o,artwork:art,palette,layer:'front'});
 const px=ctx.getImageData(0,0,W,W).data,alpha=Uint8Array.from({length:W*W},(_,i)=>px[i*4+3]);
 const stable=baselineAlpha===null||alpha.every((n,i)=>n===baselineAlpha[i]);if(baselineAlpha===null)baselineAlpha=alpha;
 paletteRows.push({skin,alphaUnchanged:stable});
}
const failures=[...faces.filter(r=>r.sourceHandAndShaftFaceOverlap),...headwear.filter(r=>r.sourceHandAndShaftHeadwearOverlap),...paletteRows.filter(r=>!r.alphaUnchanged)];
const report={scope:'Isolated actual raster face and wardrobe painter alpha, 8 source pixels/art, front action. The shared body root transform is identical for source and protected layers. This complements actual-renderer phase/DPR QA; not a native GPU claim.',faceSamples:faces.length,headwearSamples:headwear.length,faceOverlapMax:Math.max(...faces.map(r=>r.sourceHandAndShaftFaceOverlap)),headwearOverlapMax:Math.max(...headwear.map(r=>r.sourceHandAndShaftHeadwearOverlap)),headwearNames:[...new Set(headwear.map(r=>r.id))],paletteRows,failures};
fs.writeFileSync(path.join(out,'occlusion-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,faces:undefined,headwear:undefined}));a.dispose();
