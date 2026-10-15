// Diagnostic copy only. It observes the actual painter image after recoloring.
export const captures={};let activeMode=null,createCanvas=null,READ_BOOK_SPRITES={};
export function setupCapture(factory,sprites){createCanvas=factory;READ_BOOK_SPRITES=sprites;}
export function beginCapture(mode){activeMode=mode;const c=captures[mode]||={};c.order=[];for(const id of ['left','right','leftRoot','rightRoot','page','book'])if(c[id])c[id].getContext('2d').clearRect(0,0,c[id].width,c[id].height);}
export function recordRasterDraw(ctx,image,sprite){
 if(!activeMode)return;const c=captures[activeMode];let id=null;
 for(const side of ['left','right'])for(const role of ['front','root'])if(sprite.src.endsWith('/'+side+'-'+role+'-8x.png'))id=side+(role==='root'?'Root':'');
 if(sprite.src==='tools/book-front.png')id='book';if(sprite.src==='effects/page.png')id='page';if(sprite.src==='views/front/body.png'){id='bodyLocal';c.bodyLayer=ctx.canvas;}
 if(!id)return;let target=c[id];if(!target||target.width!==ctx.canvas.width||target.height!==ctx.canvas.height)target=c[id]=createCanvas(ctx.canvas.width,ctx.canvas.height);
 const dc=target.getContext('2d');dc.save();dc.setTransform(ctx.getTransform());dc.globalAlpha=ctx.globalAlpha;dc.imageSmoothingEnabled=ctx.imageSmoothingEnabled;dc.drawImage(image,...sprite.rect);dc.restore();c.order.push(id);
}
export function drawCaptured(h,mode,now){beginCapture(mode);const c=captures[mode],ctx=h.body.getContext('2d'),old=ctx.drawImage;
 ctx.drawImage=function(image,...args){if(image===c.bodyLayer){const target=c.body||=createCanvas(ctx.canvas.width,ctx.canvas.height),dc=target.getContext('2d');dc.resetTransform();dc.clearRect(0,0,target.width,target.height);dc.setTransform(ctx.getTransform());dc.globalAlpha=ctx.globalAlpha;dc.imageSmoothingEnabled=ctx.imageSmoothingEnabled;dc.drawImage(c.bodyLocal,...args);c.order.push('body');}return old.call(ctx,image,...args);};
 try{return h.draw(now);}finally{ctx.drawImage=old;activeMode=null;}
}
export function clearCaptures(){for(const c of Object.values(captures))for(const value of Object.values(c))if(value?.getContext){value.width=1;value.height=1;}for(const key of Object.keys(captures))delete captures[key];}
export function checkCaptured(mode){
 const c=captures[mode],w=c.body.width,h=c.body.height,get=id=>c[id]?.getContext('2d').getImageData(0,0,w,h).data||new Uint8ClampedArray(w*h*4),body=get('body'),book=get('book'),page=get('page'),hands={};
 for(const side of ['left','right']){const root=get(side+'Root'),palm=get(side);let roots=0,uncovered=0,palmPixels=0,bookOverlap=0,pageOverlap=0,edge255=0;for(let k=0;k<body.length;k+=4){if(root[k+3]){roots++;if(body[k+3]<250)uncovered++;}if(palm[k+3]){palmPixels++;if(book[k+3])bookOverlap++;if(palm[k+3]>=128&&page[k+3]>=128)pageOverlap++;if(palm[k+3]===255)for(const off of [-4,4,-4*w,4*w])if(k+off>=0&&k+off<page.length&&page[k+off+3]===255)edge255++;}}hands[side]={roots,uncovered,palmPixels,bookOverlap,pageOverlap,edge255,pageContactPass:pageOverlap>0||edge255>0};}
 return {width:w,height:h,order:c.order,hands};
}

export function observeArtist(artist){
 const specs=[...Object.values(READ_BOOK_SPRITES),{src:'views/front/body.png',rect:[-1.789744,8.533333,69.415385,49.066667]},{src:'tools/book-front.png',rect:[0,0,48,20]},{src:'effects/page.png',rect:[-4.5,-6,9,12]}];
 const intercept=(ctx,fn)=>{const old=ctx.drawImage;ctx.drawImage=function(image,...args){if(args.length===4){const sprite=specs.find(s=>s.rect.every((v,i)=>v===args[i]));if(sprite)recordRasterDraw(ctx,image,sprite);}return old.call(ctx,image,...args);};try{return fn();}finally{ctx.drawImage=old;}};
 return {...artist,body(ctx,...args){return intercept(ctx,()=>artist.body(ctx,...args));},action(ctx,...args){return intercept(ctx,()=>artist.action(ctx,...args));}};
}
