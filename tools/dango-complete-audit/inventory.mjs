import { PET_ACTIONS } from '../../src/content/behaviors.mjs';
import { SESSION_ACTIVITIES } from '../../src/content/session-activities.mjs';
import { EXPRESSIONS } from '../../src/content/expressions.mjs';
import { PET_APPEARANCE_ITEMS } from '../../src/content/appearance.mjs';
import { DANGO_ACTION_VIEWS } from '../../src/content/companion/dango-action-views.mjs';
import { DANGO_RASTER } from '../../assets/companion/dango/raster/dango.raster.mjs';
import { SKINS } from '../../src/skins.mjs';
import { SCENES } from '../../src/content/scenes.mjs';
import { resolveDangoView } from '../../src/core/dango-view-policy.mjs';

export const VIEWS = Object.freeze(['front', 'three-quarter', 'back']);
export const ITEMS = Object.freeze(PET_APPEARANCE_ITEMS.filter(item => item.formId === 'dango'));
export const ACTIONS = Object.freeze([
  ...Object.values(PET_ACTIONS).map(item => ({ kind: 'action', item, durationMs: item.duration })),
  ...Object.values(SESSION_ACTIVITIES).map(item => ({ kind: 'session', item, durationMs: item.durationMs }))
]);
export const PAIRS = Object.freeze(ITEMS.flatMap((a, index) => ITEMS.slice(index + 1)
  .filter(b => a.exclusiveGroup !== b.exclusiveGroup).map(b => [a, b])));
export function inventory() {
  const actionViews = ACTIONS.flatMap(({ kind, item, durationMs }) => ['front', 'three-quarter', 'profile', 'back'].map(requestedView => ({
    kind, id: item.id, durationMs, requestedView, effectiveView: resolveDangoView(requestedView, { action: item }),
    allowed: DANGO_ACTION_VIEWS[item.id].allowed.includes(requestedView === 'profile' ? 'three-quarter' : requestedView),
    alias: requestedView === 'profile', preferred: DANGO_ACTION_VIEWS[item.id].preferred
  })));
  return {
    character: 'dango', skins: Object.entries(SKINS).filter(([,skin])=>(skin.formId||'dango')==='dango').map(([id])=>id),
    scenes: Object.keys(SCENES), sceneParticles: Object.keys(DANGO_RASTER.sceneParticles), sessionRooms: Object.keys(DANGO_RASTER.sessionScenes),
    statuses: ['hungry', 'coffee'], actions: ACTIONS.filter(row => row.kind === 'action').length,
    sessions: ACTIONS.filter(row => row.kind === 'session').length, expressions: EXPRESSIONS.length,
    items: ITEMS.map(({ id, renderKey, exclusiveGroup }) => ({ id, renderKey, exclusiveGroup,
      sourceViews: Object.keys(DANGO_RASTER.appearance[renderKey].views) })),
    slots: [...new Set(ITEMS.map(item => item.exclusiveGroup))], actionViews,
    expressionsByView: EXPRESSIONS.flatMap(item => VIEWS.map(view => ({ id: item.id, view, faceExpected: view !== 'back' }))),
    pairs: PAIRS.map(pair => pair.map(item => item.id)),
    coverage: {
      singles: 'Every declared single accessory at every allowed action/view, plus static source views and targeted full-speed motion',
      pairs: 'All 99 cross-slot pairs at static source views; high-risk motion pair interactions additionally sampled',
      excluded: ['Arbitrary three-to-seven-item powerset', 'Independent three-quarter-left wardrobe PNGs: unavailable; runtime facing mirror remains supported',
        'New morning-wake scheduling or unmerged activity mirror actions', 'Native/GPU/memory validation']
    }
  };
}
if (process.argv.includes('--json')) console.log(JSON.stringify(inventory(), null, 2));
