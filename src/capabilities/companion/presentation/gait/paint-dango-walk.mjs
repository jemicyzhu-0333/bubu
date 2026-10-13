import {DANGO_SOURCE_WALK as C} from '../../../../content/companion/gait/dango-walk.mjs';
// Narrow painter hook only. Assets/caches/readiness/disposal remain owned by the host.
// Call before the existing footless body pass; suppress the old foot pass atomically.
function paintDangoWalkFeet(ctx,sample,image,{sourceReady=false,sourceSha256=null}={}){
 if(!sample?.supported||!sourceReady||sourceSha256!==C.foot.sha256||!image)return false;
 const w=image.naturalWidth??image.width,h=image.naturalHeight??image.height;
 if(w!==C.foot.width||h!==C.foot.height||!Array.isArray(sample.feet)||sample.feet.length!==2)return false;
 if(sample.feet.some(f=>!f||!['near','far'].includes(f.side))||new Set(sample.feet.map(f=>f.side)).size!==2)return false;
 for(const f of sample.feet){
  if(f.source!==C.foot.src||f.opacity!==1||!Array.isArray(f.rootWorld)||f.rootWorld.length!==2||!f.rootWorld.every(Number.isFinite))return false;
 }
 ctx.save();
 try{
  // A foot has no independent alpha mix. The host's existing alpha is inherited unchanged.
  ctx.imageSmoothingEnabled=false;
  for(const f of sample.feet){
   ctx.save();try{
    // rootWorld is the sole placement authority. Compute one pixel-snapped paint transform here;
    // the sampler deliberately exports no competing matrix. Parent transform/alpha are retained.
    const tx=Math.round(f.rootWorld[0]-(C.foot.width-C.foot.root[0]))+C.foot.width;
    const ty=Math.round(f.rootWorld[1]-C.foot.root[1]);
    ctx.transform(-1,0,0,1,tx,ty);ctx.drawImage(image,0,0);
   }finally{ctx.restore();}
  }
 }finally{ctx.restore();}
 return true;
}

export { paintDangoWalkFeet };
