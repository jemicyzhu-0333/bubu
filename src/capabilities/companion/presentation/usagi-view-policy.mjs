'use strict';

import { derivePetView } from '../../../core/pet-appearance.mjs';

const FRONT = new Set(['wave', 'high-five', 'dance', 'read', 'write', 'type', 'browse', 'trade',
  'organize', 'knit', 'drum', 'cook', 'pose', 'build', 'hide', 'fall', 'pushup', 'carry']);
const VIEWS = ['front', 'three-quarter', 'profile', 'back'];
function resolveUsagiView(requested, options = {}) {
  if (['mirror-music', 'mirror-ai'].includes(options.action?.id)) {
    return ['front', 'three-quarter'].includes(requested) ? requested : 'front';
  }
  const motion = options.action?.viewMotion || options.action?.motion;
  let allowed = VIEWS, preferred = derivePetView(options);
  if (FRONT.has(motion)) { allowed = ['front']; preferred = 'front'; }
  else if (motion === 'look' && options.action?.prop === 'binoculars') { allowed = ['front']; preferred = 'front'; }
  else if (motion === 'telescope') { allowed = ['three-quarter', 'profile']; preferred = 'three-quarter'; }
  else if (motion === 'wag') { allowed = ['back', 'three-quarter', 'profile']; preferred = 'back'; }
  else if (['sip', 'chew', 'picnic', 'mirror', 'float', 'recoil', 'sway'].includes(motion)) {
    allowed = ['front', 'three-quarter', 'profile'];
  }
  return allowed.includes(requested) ? requested : preferred;
}

export { resolveUsagiView };
