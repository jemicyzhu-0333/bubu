import fs from 'node:fs';
import {PET_ACTIONS} from './source/src/content/behaviors.mjs';
import {SESSION_ACTIVITIES,MIRROR_ACTIVITIES,SESSION_ACTIVITY_ROTATIONS,MIRROR_ROTATIONS} from './source/src/content/session-activities.mjs';
import {PET_APPEARANCE_ITEMS} from './source/src/content/appearance.mjs';
import {SCENES,SCENE_SCHEDULE,SCENE_MANUAL_SCHEDULE,SKIN_SCENE_PREFERENCES} from './source/src/content/scenes.mjs';
import {COMPANION_ACTIVITY_STORIES} from './source/src/content/companion/activity-stories.mjs';
import {FOOD_RITUALS} from './source/src/content/food-rituals.mjs';
import interactions from './source/src/content/interactions.js';
const commit='ff711d9d8a9c03a7c54d72983eb0b4f582a2a99a';
const root=new URL('./',import.meta.url);
function indexed(values,path){const text=fs.readFileSync(new URL('source/'+path,root),'utf8').split('\n');return Object.values(values).map(v=>({...v,evidence:{path,commit,line:Math.max(1,text.findIndex(s=>s.includes("'"+v.id+"'"))+1),status:'code-confirmed'}}));}
const data={schemaVersion:1,commit,scope:'V1 dango production-code inventory; separate forms retained and labeled; no runtime observations or asset verification',counts:{actions:Object.keys(PET_ACTIONS).length,sessionActivities:Object.keys(SESSION_ACTIVITIES).length,mirrors:Object.keys(MIRROR_ACTIVITIES).length,wearables:PET_APPEARANCE_ITEMS.length,dangoWearables:PET_APPEARANCE_ITEMS.filter(x=>x.formId==='dango').length,scenes:Object.keys(SCENES).length},actions:indexed(PET_ACTIONS,'src/content/behaviors.mjs'),activities:indexed({...SESSION_ACTIVITIES,...MIRROR_ACTIVITIES},'src/content/session-activities.mjs'),stories:COMPANION_ACTIVITY_STORIES,rotations:{...SESSION_ACTIVITY_ROTATIONS,...MIRROR_ROTATIONS},wearables:indexed(PET_APPEARANCE_ITEMS,'src/content/appearance.mjs'),temporaryProps:[...new Set([...Object.values(PET_ACTIONS),...Object.values(SESSION_ACTIVITIES),...Object.values(MIRROR_ACTIVITIES)].map(x=>x.prop))],backgrounds:indexed(SCENES,'src/content/scenes.mjs'),backgroundPolicy:{automatic:SCENE_SCHEDULE,manual:SCENE_MANUAL_SCHEDULE,skinPreferences:SKIN_SCENE_PREFERENCES},interactions:interactions.INTERACTIONS,foodRituals:FOOD_RITUALS};
fs.writeFileSync(new URL('FULL-INDEX.json',root),JSON.stringify(data,null,2)+'\n'); console.log(data.counts);
