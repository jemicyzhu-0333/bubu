'use strict';

const CATALOG_VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function mapExpression(expression) {
  return {
    id: expression.id,
    label: expression.label,
    group: expression.group,
    category: 'expression',
    animated: Boolean(expression.loops && expression.loops.length || expression.enter && expression.enter.durationMs)
  };
}

function mapAction(action, category = 'action') {
  return {
    id: action.id,
    label: action.name || action.label,
    category,
    kind: action.kind || null,
    motion: action.motion,
    prop: action.prop || 'none',
    expression: action.expression || null,
    durationMs: Math.round(action.duration || action.durationMs || 0),
    staticProgress: Number.isFinite(action.staticProgress) ? action.staticProgress : 0.5,
    discoveryId: action.discoveryId || null,
    minLevel: Number.isInteger(action.minLevel) ? action.minLevel : 1
  };
}

function mapScene(scene) {
  return {
    id: scene.id,
    label: scene.name,
    category: 'scene',
    periods: Array.isArray(scene.periods) ? [...scene.periods] : [],
    feature: scene.feature || null
  };
}

function mapAppearance(item) {
  return {
    id: item.id,
    label: item.label,
    category: 'appearance',
    slot: item.slot,
    layer: item.layer,
    minLevel: item.minLevel,
    skin: item.skin || null,
    unlockKind: item.unlockKind || (item.skin ? 'skin' : 'level'),
    exclusiveGroup: item.exclusiveGroup || null,
    exclusivePriority: Number.isInteger(item.exclusivePriority) ? item.exclusivePriority : 0,
    effect: item.effect || null,
    views: Array.isArray(item.views) ? [...item.views] : []
  };
}

function uniqueById(items) {
  return [...new Map(items.filter(item => item && typeof item.id === 'string')
    .map(item => [item.id, item])).values()];
}

function createPetCatalog({ content, skins = {}, views = CATALOG_VIEWS } = {}) {
  if (!content || typeof content !== 'object') throw new TypeError('pet catalog content is required');
  if (!skins || typeof skins !== 'object' || Array.isArray(skins)) throw new TypeError('pet catalog skins are required');
  const safeViews = [...new Set(Array.isArray(views) ? views : CATALOG_VIEWS)]
    .filter(view => CATALOG_VIEWS.includes(view));
  const expressions = Array.isArray(content.EXPRESSIONS)
    ? uniqueById(content.EXPRESSIONS.map(mapExpression)) : [];
  const actions = content.PET_ACTIONS && typeof content.PET_ACTIONS === 'object'
    ? uniqueById(Object.values(content.PET_ACTIONS).map(action => mapAction(action)))
    : [];
  const sessions = content.SESSION_ACTIVITIES && typeof content.SESSION_ACTIVITIES === 'object'
    ? uniqueById(Object.values(content.SESSION_ACTIVITIES)
      .map(activity => mapAction({ ...activity, name: activity.label }, 'session')))
    : [];
  const scenes = content.SCENES && typeof content.SCENES === 'object'
    ? uniqueById(Object.values(content.SCENES).map(mapScene))
    : [];
  const props = [...new Set([...actions, ...sessions].map(item => item.prop).filter(prop => prop && prop !== 'none'))]
    .sort()
    .map(prop => ({ id: prop, label: prop, category: 'prop' }));
  const skinItems = Object.entries(skins).map(([id, skin]) => ({
    id,
    label: skin && skin.name ? skin.name : id,
    category: 'skin',
    unlockDesc: skin && skin.unlockDesc ? skin.unlockDesc : null
  }));
  const appearances = Array.isArray(content.PET_APPEARANCE_ITEMS)
    ? uniqueById(content.PET_APPEARANCE_ITEMS.map(mapAppearance))
    : [];
  const counts = {
    expressions: expressions.length,
    actions: actions.length,
    sessions: sessions.length,
    props: props.length,
    scenes: scenes.length,
    skins: skinItems.length,
    appearances: appearances.length,
    views: safeViews.length
  };
  return freeze({
    version: 1,
    views: safeViews,
    counts,
    expressions,
    actions,
    sessions,
    props,
    scenes,
    skins: skinItems,
    appearances
  });
}

module.exports = Object.freeze({ CATALOG_VIEWS, createPetCatalog });
