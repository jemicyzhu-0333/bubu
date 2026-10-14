import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {DANGO_RASTER} from '../assets/companion/dango/raster/dango.raster.mjs';
import {loadLimbSource} from '../tools/dango-limbs-qa.mjs';
import {PET_ACTIONS} from '../src/content/behaviors.mjs';
import {createSourceContactPoseSelector} from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import {createDangoRasterArtist} from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import {quarterHiccupSourceContactPoseEligible as eligible,applyQuarterHiccupSourceContactPose as apply,quarterHiccupContactSpriteKeys as keys} from '../src/capabilities/companion/presentation/dango-quarter-hiccup-contact-pose.mjs';
const root=process.cwd(),b=createRequire(root+'/package.json')('@napi-rs/canvas');
const manifest=()=>structuredClone(DANGO_RASTER);
const pose=()=>({contact:{hands:[{side:'left',points:[[7.4,39.712821],[7.4,39.712821],[34.875,48.375]],gripPoint:[34.875,48.375],layer:'front',opacity:.4},{side:'right',points:[[58.6,39.7],[58.6,39.7],[54.5,48.375]],gripPoint:[54.5,48.375],layer:'front',opacity:.4}],tools:[{key:'cup',x:34,y:38}],details:[]}});
const options=(instance='one',p=.3)=>({action:PET_ACTIONS['hiccup'],motion:'hiccup',view:'three-quarter',progress:p,elapsedMs:p*6500,actionInstanceKey:instance,channel:'pet'});
const image=u=>b.loadImage(fileURLToPath(u));
test('exact action/view/contact registration, reject transforms and changed body',()=>{const m=manifest(),p=pose();assert.ok(eligible(m,p,'three-quarter',options()));for(const view of ['front','back','three-quarter-left'])assert.equal(eligible(m,p,view,options()),false);for(const id of ['snack-picnic','sip-tea','wave'])assert.equal(eligible(m,p,'three-quarter',{action:PET_ACTIONS[id]}),false);for(const extra of [{state:'dragged'},{matrix:[1,0,0,1,0,0]},{transform:{}}])assert.equal(eligible(m,p,'three-quarter',{...options(),...extra}),false);m.views['three-quarter'].body.rect[2]++;assert.equal(eligible(m,p,'three-quarter',options()),false);});
test('replaces both hands atomically without changing either target or cup',()=>{const m=manifest(),p=pose(),saved=structuredClone(p),r=apply(m,p);assert.deepEqual(p,saved);assert.equal(r.contact.tools,p.contact.tools);for(const h of r.contact.hands){assert.equal(h.opacity,.4);assert.deepEqual(h.gripPoint,p.contact.hands.find(x=>x.side===h.side).gripPoint);assert.equal(h.limb,false);assert.deepEqual(h.pawMatrix,[1,0,0,1,0,0]);}assert.equal(r.contact.hands[1].pawOcclusion,'behind-tool');assert.equal(keys().length,2);m.tools[keys()[1]].sourceContactPose.runtimeReady=false;assert.equal(eligible(m,p,'three-quarter',options()),false);});
test('whole-window cold readiness and failure prevent mid-action pop-in',()=>{let state='loading';const m=manifest(),s=createSourceContactPoseSelector({manifest:m,source:{state:()=>state}}),p=pose();assert.equal(s.apply(p,'three-quarter',options()).sourceContactPose,undefined);state='ready';assert.equal(s.apply(p,'three-quarter',options('one',.4)).sourceContactPose,undefined);assert.equal(s.apply(p,'three-quarter',options('two',0)).sourceContactPose,'hiccup-quarter-pair-v1');state='failed';assert.equal(s.apply(p,'three-quarter',options('two',.2)).sourceContactPose,undefined);state='ready';assert.equal(s.apply(p,'three-quarter',options('two',.3)).sourceContactPose,undefined);assert.equal(s.apply(p,'three-quarter',options('three',0)).sourceContactPose,'hiccup-quarter-pair-v1');s.dispose();assert.equal(s.stats().channels,3);});
test('interruption/cancel cannot leak source, and channels remain bounded',()=>{const s=createSourceContactPoseSelector({manifest:manifest(),source:{state:()=> 'ready'}}),p=pose();assert.equal(s.apply(p,'three-quarter',options()).sourceContactPose,'hiccup-quarter-pair-v1');assert.equal(s.apply(p,'front',{...options('stop'),action:null}).sourceContactPose,undefined);for(let i=0;i<40;i++)s.apply(p,'three-quarter',{...options(String(i)),channel:'test-'+i});assert.equal(s.stats().channels,16);assert.equal(s.apply(p,'three-quarter',{...options('overflow'),channel:'test-overflow'}).sourceContactPose,undefined);s.dispose();});
test('real artist cold source fallback stays complete until next instance and disposes',async()=>{const a=createDangoRasterArtist({manifest:manifest(),createSurface:b.createCanvas,loadImage:image});const ready=a.ready({all:true});assert.notEqual(a.resolveArtwork(options()).sourceContactPose,'hiccup-quarter-pair-v1');await ready;assert.equal(a.cacheStats().source.failed,0);assert.notEqual(a.resolveArtwork(options('one',.5)).sourceContactPose,'hiccup-quarter-pair-v1');assert.equal(a.resolveArtwork(options('two',0)).sourceContactPose,'hiccup-quarter-pair-v1');a.dispose();assert.equal(a.cacheStats().source.bytes,0);assert.equal(a.cacheStats().palette.bytes,0);});
test('real source image failure reports failure and keeps original hand path',async()=>{const a=createDangoRasterArtist({manifest:manifest(),createSurface:b.createCanvas,loadImage:u=>new URL(u).pathname.endsWith('/hiccup-quarter-pair-v1/far-8x.png')?Promise.reject(Error('test source unavailable')):image(u)});await a.ready({all:true});const r=a.resolveArtwork(options());assert.notEqual(r.sourceContactPose,'hiccup-quarter-pair-v1');assert.equal(r.contact.hands.filter(h=>h.pawSprite==='small-fin').length,2);assert.equal(a.cacheStats().source.failed,1);a.dispose();});

test('limb-loaded far failure preserves the host baseline without a partial source pair',async()=>{
 const limbs=await loadLimbSource(),m=manifest(),old=manifest();for(const key of keys())old.tools[key].sourceContactPose.runtimeReady=false;
 const failed=createDangoRasterArtist({manifest:m,limbs,createSurface:b.createCanvas,loadImage:u=>new URL(u).pathname.endsWith('/hiccup-quarter-pair-v1/far-8x.png')?Promise.reject(Error('test far unavailable')):image(u)});
 const baseline=createDangoRasterArtist({manifest:old,limbs,createSurface:b.createCanvas,loadImage:image});
 try{await Promise.all([failed.ready({all:true}),baseline.ready({all:true})]);const actual=failed.resolveArtwork(options()),expected=baseline.resolveArtwork(options());assert.deepEqual(actual.contact,expected.contact);assert.notEqual(actual.sourceContactPose,'hiccup-quarter-pair-v1');assert.ok(actual.contact.hands.every(h=>!keys().includes(h.pawSprite)));assert.equal(failed.cacheStats().source.failed,1);}finally{failed.dispose();baseline.dispose();}
});

test('quarter hiccup source pair retains four-color binary pixels, hash and exact nearest8x', async () => {
  const { createHash } = await import('node:crypto');
  for (const side of ['near', 'far']) {
  const sprite = DANGO_RASTER.tools[keys()[side === 'near' ? 0 : 1]];
  const raw = fs.readFileSync(new URL(sprite.src, DANGO_RASTER.baseUrl));
  assert.equal(createHash('sha256').update(raw).digest('hex'), sprite.sourceContactPose.sourceSha256);
  const read = async name => {
    const im = await b.loadImage(fileURLToPath(new URL('action-contact/hiccup-quarter-pair-v1/' + name, DANGO_RASTER.baseUrl)));
    const canvas = b.createCanvas(im.width, im.height), context = canvas.getContext('2d');
    context.drawImage(im, 0, 0);
    return { width: im.width, height: im.height, data: context.getImageData(0, 0, im.width, im.height).data };
  };
  const [lo, hi] = await Promise.all([side + '-logical.png', side + '-8x.png'].map(read));
  assert.deepEqual([hi.width, hi.height], [lo.width * 8, lo.height * 8]);
  const colors = new Set();
  for (let i = 0; i < lo.data.length; i += 4) {
    assert.ok(lo.data[i + 3] === 0 || lo.data[i + 3] === 255);
    if (lo.data[i + 3]) colors.add(Array.from(lo.data.slice(i, i + 3)).join(','));
    else assert.deepEqual(Array.from(lo.data.slice(i, i + 4)), [0, 0, 0, 0]);
  }
  const palette = ['26,27,38', '240,80,104', '248,104,120', '248,128,128'];
  assert.ok([...colors].every(color => palette.includes(color)));
  assert.equal(colors.size, side === 'near' ? 4 : 3);
  for (let y = 0; y < hi.height; y++) for (let x = 0; x < hi.width; x++) {
    const a = (y * hi.width + x) * 4, z = (Math.floor(y / 8) * lo.width + Math.floor(x / 8)) * 4;
    for (let c = 0; c < 4; c++) assert.equal(hi.data[a + c], lo.data[z + c]);
  }
  }
});
