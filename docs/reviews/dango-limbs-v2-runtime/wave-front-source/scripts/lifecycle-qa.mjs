import fs from 'node:fs';import {fixture,argumentsFor,finish} from './fixture.mjs';
const config=argumentsFor('lifecycle'),base=config.out;
const f=await fixture(config),failures=[],reports=[];
const scenarios=[{id:'complete',end:8200,events:[[300,'wave'],[7300,null]]},{id:'interrupt-stop-reopen',end:14200,events:[[300,'wave'],[2200,'sip-tea'],[3200,'wave'],[5100,null],[6100,'wave'],[13100,null]]},{id:'reduced-resume',end:8200,calm:[2300,4200],events:[[300,'wave'],[7300,null]]},{id:'heavy-mirrored',end:8200,facing:-1,outfit:['milestone.sunhat','milestone.scarf','milestone.boots','milestone.cape'],events:[[300,'wave'],[7300,null]]}];
for(const scenario of scenarios){f.nextCase();const pair={};for(const mode of['legacy','candidate']){const o={skin:'pink',outfit:scenario.outfit||false,dpr:2,facing:scenario.facing||1,view:'front',blink:false,expressionFor:s=>f.sources[mode].behaviors.PET_ACTIONS[s.currentEgg?.id]?.expression||'life.idle'};const h=f.createRenderHarness(f.sources[mode],o);h.select('expression','life.idle');h.updateState({devPreview:null,currentEgg:null,appearanceItemIds:scenario.outfit||[]});pair[mode]={h,o};}
 let ei=0,active=0,recovery=0;const rows=[];
 for(let now=0;now<=scenario.end;now+=20){while(ei<scenario.events.length&&now>=scenario.events[ei][0]){const[at,id]=scenario.events[ei++];const egg=id?{...f.sources.candidate.interactionPlayback.createManualActionPlayback(f.sources.candidate.behaviors,id,{formId:'dango'}),presentationEventId:`wave-lifecycle-${scenario.id}-${at}`}:null;for(const{h}of Object.values(pair))h.updateState({currentEgg:egg,actionStartedAt:at});}
  for(const{h,o}of Object.values(pair)){o.calm=Boolean(scenario.calm&&now>=scenario.calm[0]&&now<scenario.calm[1]);h.draw(now);}
  const old=f.traces.legacy,fresh=f.traces.candidate,art=fresh.art,o=fresh.options,h=art.contact?.hands?.[0];
  if(o.action?.id==='wave'){active++;if(art.sourceContactPose!=='wave-front-v1')failures.push(`${scenario.id}:${now}: source dropped`);if(o.action.handoffRecovery!==undefined)recovery++;if(h?.limb||h?.connector||h?.attachedArm)failures.push(`${scenario.id}:${now}: duplicate limb`);if(o.calmVisual&&h?.sourceContact?.keypose!==3)failures.push(`${scenario.id}:${now}: calm still moving`);}
  else if(art.sourceContactPose==='wave-front-v1'||art.contact?.hands.some(h=>h.pawSprite?.startsWith('wave-front')))failures.push(`${scenario.id}:${now}: stale hand`);
  for(const field of['data','footwearTransforms'])if(JSON.stringify(old.art[field])!==JSON.stringify(art[field]))failures.push(`${scenario.id}:${now}: ${field} changed`);
  if(config.frames)rows.push({now,id:o.action?.id||null,progress:o.progress,view:art.view,source:art.sourceContactPose||null,propOpacity:o.action?.propOpacity??1,recovery:o.action?.handoffRecovery??null,handOpacity:h?.opacity??null,keypose:h?.sourceContact?.keypose??null});
  if(config.images&&[0,300,580,1280,2200,2300,2500,3200,4200,5100,5300,6100,7300,7500,scenario.end].includes(now))fs.writeFileSync(base+`/lifecycle-${scenario.id}-${now}.png`,pair.candidate.h.body.toBuffer('image/png'));
  if(now%1000===0)await new Promise(r=>setImmediate(r));
 }
 reports.push({id:scenario.id,frames:scenario.end/20+1,sourceFrames:active,recoveryFrames:recovery,rows});for(const{h}of Object.values(pair))h.dispose();
}
const report={evidence:'Actual production action playback plus createPetRenderer; wave default front, no view adapter. Candidate uses the integrated manifest and unchanged production source selector. Offscreen Skia, no native OS claim.',reports:reports.map(({rows,...r})=>r),failures};if(config.frames)fs.writeFileSync(base+'/lifecycle-frames.json',JSON.stringify(reports,null,2)+'\n');finish(base,'lifecycle-report',report);f.dispose();
