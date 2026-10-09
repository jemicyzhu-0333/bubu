import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function cataloguePoses(root, { includeValues = false } = {}) {
  const load = file => import(pathToFileURL(path.join(root, file)).href);
  const [{default: rig}, {PET_ACTIONS}, {SESSION_ACTIVITIES}, {COMPANION_ACTIVITY_STORIES}, {sampleActivityStory},
    {createRigArtist}, {createPathCache}, {default: support}] = await Promise.all([
    load('assets/companion/usagi/rig/usagi.rig.mjs'), load('src/content/behaviors.mjs'), load('src/content/session-activities.mjs'),
    load('src/content/companion/activity-stories.mjs'), load('src/capabilities/companion/presentation/activity-playback.mjs'),
    load('src/capabilities/companion/presentation/rig/rig-art.mjs'), load('src/capabilities/companion/presentation/rig/paint.mjs'),
    load('src/capabilities/companion/presentation/usagi-support.mjs')]);
  const artist = createRigArtist({fallback: support, paths: createPathCache({createPath: d => ({d})})});
  const records = [];
  const add = (action, progress, stage) => {
    const free = action.motion === 'wave' && ['wave','rest-window','rest-plant'].includes(action.id)
      || action.motion === 'stretch' && ['stretch','rest-stretch','rest-daydream'].includes(action.id) && action.prop === 'none';
    for (const view of Object.keys(rig.views)) for (const calmVisual of [false,true]) {
      const artwork = artist.resolve(rig,{action,motion:action.motion,view,progress,calmVisual});
      const world = Object.fromEntries(Object.entries(artwork.pose.world).filter(([key]) => !free || !/^(arm|hand)_/.test(key)));
      const {props,propPoses} = artwork.pose.sample;
      const values = {world,props,propPoses};
      records.push({id:action.id,stage,progress,view,calmVisual,excludeHands:free,
        hash:crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex'),
        ...(includeValues ? {values} : {})});
    }
  };
  for (const action of Object.values(PET_ACTIONS)) for (const progress of [0,.04,.12,.25,.5,.75,.88,.96,.999]) add(action,progress,null);
  for (const [id,story] of Object.entries(COMPANION_ACTIVITY_STORIES)) {
    let start=0;
    for (const [stage,beat] of story.stages.entries()) {
      for (const local of [.04,.5,.96]) {
        const sampled=sampleActivityStory(SESSION_ACTIVITIES[id],start+(beat.until-start)*local/beat.cycles);
        add(sampled.action,sampled.progress,stage);
      }
      start=beat.until;
    }
  }
  return records;
}
