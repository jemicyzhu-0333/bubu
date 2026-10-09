'use strict';

// Runs only against the isolated dev profile created by launch.js.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../../dist/companion-v2');
const errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('companion verification timed out'); app.exit(1); }, 60000);
app.on('browser-window-created', (_, win) => {
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
});
require('./launch');

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const windows = BrowserWindow.getAllWindows();
  const pet = windows.find(w => w.webContents.getURL().endsWith('/pet.html'));
  const popover = windows.find(w => w.webContents.getURL().endsWith('/popover.html'));
  assert.ok(pet && popover);
  const save = async (contents, selector, file) => {
    const url = await contents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).toDataURL()`);
    fs.writeFileSync(path.join(output, file), Buffer.from(url.split(',')[1], 'base64'));
  };
  const gallery = await pet.webContents.executeJavaScript(`(async () => {
    const { forms, formArt } = await import('../capabilities/companion/index.mjs');
    const petArt = await import('../core/pet-art.mjs');
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1140;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f4f1eb'; ctx.fillRect(0,0,1200,1140);
    const form = forms.resolvePetForm('usagi'), palette = formArt.paletteForSkin('usagi',form);
    const { default: artist } = await import('../capabilities/companion/presentation/usagi-art.mjs');
    const cells = ['front','three-quarter','profile','back'].map(view => ({view, motion:'idle', eyes:'neutral',mouth:'open'}));
    for (const view of ['front','three-quarter','profile','back']) cells.push({view,motion:'idle',eyes:'neutral',mouth:'open',clothed:true});
    for (const motion of ['wave','hop','sip','read']) cells.push({view:'front',motion,eyes:'smile',mouth:'open'});
    const {projectAppearance} = await import('../core/pet-appearance.mjs');
    for (let i=0;i<cells.length;i++) {
      const c=cells[i], x=(i%4)*300, y=Math.floor(i/4)*330;
      ctx.save(); ctx.translate(x+68,y+85); ctx.scale(2.3,2.3);
      const face={eyes:c.eyes,mouth:c.mouth,openness:1};
      const artwork=artist.resolveArtwork({...c,face,progress:0.5,calmVisual:true});
      if (artwork?.kind !== 'rig') throw new Error('production artist did not select rig');
      for (const layer of ['back','body','face','front']) {
        if (layer==='body') artist.body(ctx,palette,c.view,artwork);
        else if (layer==='face') artist.face(ctx,palette,face,false,c.view,form.faceRig,artwork);
        else {
          if(c.clothed) for(const item of projectAppearance({skin:'usagi',formId:'usagi',level:25,view:c.view}).items.filter(item=>item.parts.includes(layer))) artist.appearance(ctx,{item,layer,form,palette,view:c.view,artwork});
          artist.action(ctx,{...c,progress:0.5,layer,form,palette,calmVisual:true,artwork});
        }
      }
      ctx.restore(); ctx.fillStyle='#443b3b'; ctx.font='18px Segoe UI'; ctx.fillText(c.view+' / '+c.motion,x+50,y+285);
    }
    for (const [i,view] of ['front','three-quarter','profile','back'].entries()) {
      const sprite=document.createElement('canvas'), geo={bodySize:66,cell:2,deviceScale:3};
      sprite.width=sprite.height=198;
      petArt.paintBodySprite(sprite,petArt.PALETTES.pink,'normal',geo,view);
      const faceRig=await import('../core/pet-face.mjs');
      petArt.drawLiveFace(sprite.getContext('2d'),petArt.PALETTES.pink,{eyes:'neutral',mouth:'smile',eyeOffsetX:0,eyeOffsetY:0},false,{cell:2,faceRig,view});
      ctx.drawImage(sprite,i*180+250,1016,99,99);
    }
    return canvas.toDataURL();
  })()`);
  fs.writeFileSync(path.join(output, 'rig-gallery.png'), Buffer.from(gallery.split(',')[1], 'base64'));
  const rigScan = await pet.webContents.executeJavaScript(`(async () => {
    const {forms, formArt} = await import('../capabilities/companion/index.mjs');
    const {default: artist} = await import('../capabilities/companion/presentation/usagi-art.mjs');
    const form = forms.resolvePetForm('usagi'), palette = formArt.paletteForSkin('usagi', form);
    const canvas = document.createElement('canvas'); canvas.width=200; canvas.height=180;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    const {projectAppearance} = await import('../core/pet-appearance.mjs');
    const face={eyes:'neutral', mouth:'open', openness:1};
    let samples=0;
    for (const view of ['front','three-quarter','profile','back']) {
      for (const motion of ['idle', ...form.supportedMotions]) {
        for (const clothed of [false,true]) for (let phase=0; phase<=8; phase++) {
          const progress=phase/8;
          const artwork=artist.resolveArtwork({view,motion,face,progress,calmVisual:false});
          ctx.save(); ctx.translate(50,60);
          for (const layer of ['back','body','face','front']) {
            if (layer==='body') artist.body(ctx,palette,view,artwork);
            else if (layer==='face') artist.face(ctx,palette,face,false,view,form.faceRig,artwork);
            else {
              if(clothed) for(const item of projectAppearance({skin:'usagi',formId:'usagi',level:25,view}).items.filter(item=>item.parts.includes(layer))) artist.appearance(ctx,{item,layer,form,palette,view,artwork});
              artist.action(ctx,{view,motion,progress,layer,form,palette,calmVisual:false,artwork});
            }
          }
          ctx.restore(); samples++;
        }
      }
    }
    const pixels=ctx.getImageData(0,0,200,180).data;
    const ink={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
    for(let y=0;y<180;y++) for(let x=0;x<200;x++) if(pixels[(y*200+x)*4+3]>8) {
      ink.left=Math.min(ink.left,x-50); ink.top=Math.min(ink.top,y-60);
      ink.right=Math.max(ink.right,x-50+1); ink.bottom=Math.max(ink.bottom,y-60+1);
    }
    const b=form.artBounds;
    if(ink.left<b.x || ink.top<b.y || ink.right>b.x+b.width || ink.bottom>b.y+b.height)
      throw new Error('Rig animated ink exceeds declared bounds: '+JSON.stringify(ink));
    return {samples,ink,bounds:b};
  })()`);
  await popover.webContents.executeJavaScript("window.focuspix.switchSkin('usagi')");
  await pause(250);
  await save(pet.webContents, '#petCanvas', 'pet.png');
  popover.showInactive();
  await popover.webContents.executeJavaScript("document.getElementById('btnOpenSkins').click()");
  await pause(350);
  const species = await popover.webContents.executeJavaScript("[...document.querySelectorAll('#skinSpecies [data-form]')].map(x=>x.dataset.form)");
  assert.deepEqual(species, ['dango', 'usagi']);
  await popover.webContents.executeJavaScript("document.querySelector('[data-form=dango]').click()");
  const skins = await popover.webContents.executeJavaScript("[...document.querySelectorAll('#skinStrip [data-skin]')].map(x=>x.dataset.skin)");
  assert.equal(skins.length, 10); assert.ok(!skins.includes('usagi'));
  await pause(250);
  fs.writeFileSync(path.join(output, 'picker.png'), (await popover.webContents.capturePage()).toPNG());
  const report = [];
  const corners = screen.getAllDisplays().flatMap(display => {
    const area = display.workArea;
    return [[area.x,area.y], [area.x+area.width-220,area.y+area.height-220]]
      .map(([x,y]) => ({display, area, x, y}));
  });
  for (const {display, area, x, y} of corners) {
    await pet.webContents.executeJavaScript(`window.focuspix.pet_setPosition(${x},${y})`);
    const before=pet.getBounds();
    const stageBefore=await pet.webContents.executeJavaScript("(() => { const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y}; })()");
    await pet.webContents.executeJavaScript("document.getElementById('petHit').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");
    await pause(450);
    assert.deepEqual(pet.getBounds(),before,'menu must not resize the backing window');
    const layout=await pet.webContents.executeJavaScript(`(() => {
      const r=document.getElementById('commandMenu').getBoundingClientRect();
      return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};
    })()`);
    assert.ok(layout.left>=0 && layout.top>=0 && layout.right<=layout.width && layout.bottom<=layout.height, JSON.stringify(layout));
    await pet.webContents.executeJavaScript("document.querySelector('[data-act=feed]').click()");
    await pause(200);
    const food=await pet.webContents.executeJavaScript(`(() => {
      const r=document.getElementById('foodPanel').getBoundingClientRect();
      return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};
    })()`);
    assert.ok(food.left>=0 && food.top>=0 && food.right<=food.width && food.bottom<=food.height, JSON.stringify(food));
    fs.writeFileSync(path.join(output, 'food-'+report.length+'.png'), (await pet.webContents.capturePage()).toPNG());
    await pet.webContents.executeJavaScript("document.getElementById('foodClose').click()");
    await pause(150);
    assert.deepEqual(pet.getBounds(), before);
    const stageAfter=await pet.webContents.executeJavaScript("(() => { const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y}; })()");
    assert.deepEqual(stageAfter,stageBefore,'stage cannot move on menu round-trip');
    report.push({displayId: display.id, scaleFactor: display.scaleFactor, workArea: area, before,layout,food});
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({rigScan,report,errors}, null, 2));
  console.log(JSON.stringify({output,rigScan,report,errors}));
}
app.whenReady().then(() => pause(2000)).then(run).then(() => app.quit()).catch(error => {
  console.error(error.stack); app.exit(1);
}).finally(() => clearTimeout(deadline));
