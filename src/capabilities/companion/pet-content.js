'use strict';

const { createPetCatalog } = require('./pet-catalog');

const PET_CONTENT_FIELDS = Object.freeze([
  'LINES',
  'SCENE_DECORATIONS',
  'SCENES',
  'SCENE_SCHEDULE',
  'SCENE_MANUAL_SCHEDULE',
  'SKIN_SCENE_PREFERENCES',
  'PET_ACTIONS',
  'SESSION_ACTIVITIES',
  'SESSION_ACTIVITY_ROTATIONS',
  'MIRROR_ACTIVITIES',
  'MIRROR_ROTATIONS',
  'STATE_SCENES',
  'SKIN_SCENES',
  'INTERACTIONS',
  'FOODS',
  'EXPRESSIONS',
  'EXPRESSION_LIBRARY_STATS',
  'PET_APPEARANCE_ITEMS',
  'PET_APPEARANCE_VIEWS',
  'PET_CATALOG'
]);

function createPetContentQuery({ content, manifest, catalog, skins } = {}) {
  if (!content || typeof content !== 'object') throw new TypeError('pet content is required');
  if (!manifest || typeof manifest !== 'object') throw new TypeError('pet content manifest is required');
  const resolvedCatalog = catalog || createPetCatalog({ content, skins });
  if (!resolvedCatalog || typeof resolvedCatalog !== 'object') throw new TypeError('pet content catalog is required');
  return () => {
    const projection = {};
    for (const field of PET_CONTENT_FIELDS) projection[field] = content[field];
    projection.manifest = manifest;
    projection.PET_CATALOG = resolvedCatalog;
    return projection;
  };
}

module.exports = Object.freeze({ PET_CONTENT_FIELDS, createPetContentQuery });
