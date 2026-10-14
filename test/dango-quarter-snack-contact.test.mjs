import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {DANGO_RASTER} from '../assets/companion/dango/raster/dango.raster.mjs';
import {PET_ACTIONS} from '../src/content/behaviors.mjs';
import {createSourceContactPoseSelector} from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import {createDangoRasterArtist} from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import {quarterSnackSourceContactPoseEligible as eligible,applyQuarterSnackSourceContactPose as apply,quarterSnackContactSpriteKeys as keys} from '../src/capabilities/companion/presentation/dango-quarter-snack-contact-pose.mjs';
const root=process.cwd(),b=createRequire(root+'/package.json')('@napi-rs/canvas');
const manifest=()=>structuredClone(DANGO_RASTER);
const pose=()=>({contact:{hands:[{side:'left',points:[[7.4,39.712821],[18.575,51.447],[23,54]],layer:'front',opacity:.4},{side:'right',points:[[58.6,39.7],[58,42],[58,43]],layer:'front'}],tools:[{key:'picnic-mat',x:2,y:56,layer:'back'},{key:'sandwich',x:48,y:38}],details:[]}});
const options=(instance='one',p=.3)=>({action:PET_ACTIONS['snack-picnic'],motion:'picnic',view:'three-quarter',progress:p,elapsedMs:p*11000,actionInstanceKey:instance,channel:'pet'});
const image=u=>b.loadImage(fileURLToPath(u));
test('exact action/view/contact registration, reject transforms and changed body',()=>{const m=manifest(),p=pose();assert.ok(eligible(m,p,'three-quarter',options()));for(const view of ['front','back','three-quarter-left'])assert.equal(eligible(m,p,view,options()),false);for(const id of ['hiccup','sip-tea','wave'])assert.equal(eligible(m,p,'three-quarter',{action:PET_ACTIONS[id]}),false);for(const extra of [{state:'dragged'},{matrix:[1,0,0,1,0,0]},{transform:{}}])assert.equal(eligible(m,p,'three-quarter',{...options(),...extra}),false);m.views['three-quarter'].body.rect[2]++;assert.equal(eligible(m,p,'three-quarter',options()),false);});
test('replaces only near free-rest hand without touching tools or the eating hand',()=>{const m=manifest(),p=pose(),saved=structuredClone(p),r=apply(m,p);assert.deepEqual(p,saved);assert.equal(r.contact.tools,p.contact.tools);assert.equal(r.contact.hands[1],p.contact.hands[1]);assert.equal(r.contact.hands[0].opacity,.4);assert.deepEqual(r.contact.hands[0].points,p.contact.hands[0].points);assert.equal(r.contact.hands[0].limb,false);assert.deepEqual(r.contact.hands[0].pawMatrix,[1,0,0,1,0,0]);assert.equal(keys().length,1);});
test('whole-window cold readiness and failure prevent mid-action pop-in',()=>{let state='loading';const m=manifest(),s=createSourceContactPoseSelector({manifest:m,source:{state:()=>state}}),p=pose();assert.equal(s.apply(p,'three-quarter',options()).sourceContactPose,undefined);state='ready';assert.equal(s.apply(p,'three-quarter',options('one',.4)).sourceContactPose,undefined);assert.equal(s.apply(p,'three-quarter',options('two',0)).sourceContactPose,'snack-quarter-near-v1');state='failed';assert.equal(s.apply(p,'three-quarter',options('two',.2)).sourceContactPose,undefined);state='ready';assert.equal(s.apply(p,'three-quarter',options('two',.3)).sourceContactPose,undefined);assert.equal(s.apply(p,'three-quarter',options('three',0)).sourceContactPose,'snack-quarter-near-v1');s.dispose();assert.equal(s.stats().channels,3);});
test('interruption/cancel cannot leak source, and channels remain bounded',()=>{const s=createSourceContactPoseSelector({manifest:manifest(),source:{state:()=> 'ready'}}),p=pose();assert.equal(s.apply(p,'three-quarter',options()).sourceContactPose,'snack-quarter-near-v1');assert.equal(s.apply(p,'front',{...options('stop'),action:null}).sourceContactPose,undefined);for(let i=0;i<40;i++)s.apply(p,'three-quarter',{...options(String(i)),channel:'test-'+i});assert.equal(s.stats().channels,16);assert.equal(s.apply(p,'three-quarter',{...options('overflow'),channel:'test-overflow'}).sourceContactPose,undefined);s.dispose();});
test('real artist cold source fallback stays complete until next instance and disposes',async()=>{const a=createDangoRasterArtist({manifest:manifest(),createSurface:b.createCanvas,loadImage:image});const ready=a.ready({all:true});assert.notEqual(a.resolveArtwork(options()).sourceContactPose,'snack-quarter-near-v1');await ready;assert.equal(a.cacheStats().source.failed,0);assert.notEqual(a.resolveArtwork(options('one',.5)).sourceContactPose,'snack-quarter-near-v1');assert.equal(a.resolveArtwork(options('two',0)).sourceContactPose,'snack-quarter-near-v1');a.dispose();assert.equal(a.cacheStats().source.bytes,0);assert.equal(a.cacheStats().palette.bytes,0);});
test('real source image failure reports failure and keeps original hand path',async()=>{const a=createDangoRasterArtist({manifest:manifest(),createSurface:b.createCanvas,loadImage:u=>new URL(u).pathname.includes('/snack-quarter-near-v1/')?Promise.reject(Error('test source unavailable')):image(u)});await a.ready({all:true});const r=a.resolveArtwork(options());assert.notEqual(r.sourceContactPose,'snack-quarter-near-v1');assert.equal(r.contact.hands.find(h=>h.side==='left').pawSprite,undefined);assert.equal(a.cacheStats().source.failed,1);a.dispose();});

test('snack source retains four-color binary pixels, hash and exact nearest8x', async () => {
  const { createHash } = await import('node:crypto');
  const sprite = DANGO_RASTER.tools[keys()[0]];
  const raw = fs.readFileSync(new URL(sprite.src, DANGO_RASTER.baseUrl));
  assert.equal(createHash('sha256').update(raw).digest('hex'), sprite.sourceContactPose.sourceSha256);
  const read = async name => {
    const im = await b.loadImage(fileURLToPath(new URL('action-contact/snack-quarter-near-v1/' + name, DANGO_RASTER.baseUrl)));
    const canvas = b.createCanvas(im.width, im.height), context = canvas.getContext('2d');
    context.drawImage(im, 0, 0);
    return { width: im.width, height: im.height, data: context.getImageData(0, 0, im.width, im.height).data };
  };
  const [lo, hi] = await Promise.all(['near-logical.png', 'near-8x.png'].map(read));
  assert.deepEqual([hi.width, hi.height], [lo.width * 8, lo.height * 8]);
  const colors = new Set();
  for (let i = 0; i < lo.data.length; i += 4) {
    assert.ok(lo.data[i + 3] === 0 || lo.data[i + 3] === 255);
    if (lo.data[i + 3]) colors.add(Array.from(lo.data.slice(i, i + 3)).join(','));
    else assert.deepEqual(Array.from(lo.data.slice(i, i + 4)), [0, 0, 0, 0]);
  }
  assert.deepEqual([...colors].sort(), ['26,27,38', '240,80,104', '248,104,120', '248,128,128'].sort());
  for (let y = 0; y < hi.height; y++) for (let x = 0; x < hi.width; x++) {
    const a = (y * hi.width + x) * 4, z = (Math.floor(y / 8) * lo.width + Math.floor(x / 8)) * 4;
    for (let c = 0; c < 4; c++) assert.equal(hi.data[a + c], lo.data[z + c]);
  }
});
