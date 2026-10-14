import fs from'node:fs';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{fixture}from'./fixture.mjs';
const arg=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const root=path.resolve(arg('repo',path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../..'))),out=path.resolve(arg('out',path.join(root,'meta/umbrella-front-source-qa/lifecycle'))),images=process.argv.includes('--images');fs.mkdirSync(out,{recursive:true});
const candidate=async({backend,limbs,manifest,createArtist,trace})=>{const a=createArtist({manifest,limbs,createSurface:backend.createCanvas,loadImage:u=>backend.loadImage(fileURLToPath(u))});return{...a,resolveArtwork(o){const art=a.resolveArtwork(o);trace(o,art);return art;}};};
const f=await fixture(root,out,{candidate,forceFront:true}),scenarios=[{id:'complete',end:12000,events:[[300,'umbrella-dance'],[10300,null]]},{id:'interrupt-reopen',end:18500,events:[[300,'umbrella-dance'],[3200,'wave'],[4200,'umbrella-dance'],[6200,null],[7000,'umbrella-dance'],[17000,null]]},{id:'reduced-resume',end:12000,calm:[2300,4200],events:[[300,'umbrella-dance'],[10300,null]]}],failures=[],reports=[];
for(const scenario of scenarios){
 const pair={};for(const mode of['legacy','candidate']){const o={skin:'pink',outfit:false,dpr:2,view:'front',blink:false,expressionFor:s=>f.sources[mode].behaviors.PET_ACTIONS[s.currentEgg?.id]?.expression||'life.idle'};const h=f.createRenderHarness(f.sources[mode],o);h.select('expression','life.idle');h.updateState({devPreview:null,currentEgg:null,appearanceItemIds:[]});pair[mode]={h,o};}
 let ei=0,active=0,recovery=0;const rows=[];
 for(let now=0;now<=scenario.end;now+=20){
  while(ei<scenario.events.length&&now>=scenario.events[ei][0]){const[at,id]=scenario.events[ei++];const egg=id?{...f.sources.candidate.interactionPlayback.createManualActionPlayback(f.sources.candidate.behaviors,id,{formId:'dango'}),presentationEventId:`umbrella-lifecycle-${scenario.id}-${at}`} : null;for(const{h}of Object.values(pair))h.updateState({currentEgg:egg,actionStartedAt:at});}
  for(const {h,o}of Object.values(pair)){o.calm=Boolean(scenario.calm&&now>=scenario.calm[0]&&now<scenario.calm[1]);h.draw(now);}
  const old=f.traces.legacy.at(-1),fresh=f.traces.candidate.at(-1),art=fresh.art,o=fresh.options;
  if(o.action?.id==='umbrella-dance'){
   active++;if(art.sourceContactPose!=='umbrella-front-v1')failures.push(`${scenario.id}:${now}: source dropped during umbrella`);
   if(o.action.handoffRecovery!==undefined)recovery++;
   if(art.contact?.tools.filter(t=>t.key.startsWith('umbrella-front-v1-')).length!==2)failures.push(`${scenario.id}:${now}: depth pair split`);
   if(art.contact.hands[0].limb)failures.push(`${scenario.id}:${now}: generic source supplanted`);
  }else if(art.sourceContactPose==='umbrella-front-v1')failures.push(`${scenario.id}:${now}: stale umbrella`);
  if(JSON.stringify(old.art.data.body)!==JSON.stringify(art.data.body))failures.push(`${scenario.id}:${now}: body descriptor changed`);
  if(now%200===0||o.action?.handoffRecovery!==undefined)rows.push({now,id:o.action?.id||null,progress:o.progress,view:art.view,source:art.sourceContactPose||null,propOpacity:o.action?.propOpacity??1,recovery:o.action?.handoffRecovery??null,handOpacity:art.contact?.hands?.[0]?.opacity??1});
  if(images&&[0,300,500,1000,3000,3200,3400,4000,4200,4400,6200,6400,7000,10300,10500,11000,17000,17200,18000].includes(now))fs.writeFileSync(path.join(out,`${scenario.id}-${now}.png`),pair.candidate.h.body.toBuffer('image/png'));
 }
 reports.push({id:scenario.id,frames:scenario.end/20+1,sourceFrames:active,recoveryFrames:recovery,rows});
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({scope:'Real production action playback/renderer with test-only front-view workbench adapter. Default umbrella auto view remains three-quarter and does not select this front asset.',reports:reports.map(({rows,...r})=>r),failures},null,2));console.log(JSON.stringify({scenarios:reports.map(({rows,...r})=>r),failures}));f.dispose();
