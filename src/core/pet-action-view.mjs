import { BODY_ANCHORS } from '../content/companion/dango-body.mjs';

// Shared art-space projection for hands AND held objects. Rounding belongs
// to the pixel painter, after the same projection has been applied to both.
function actionViewX(x, view = 'front') {
  if (view === 'profile') {
    return BODY_ANCHORS.profile['shoulder-right'].x
      + (x - BODY_ANCHORS.front['shoulder-right'].x) * 0.86;
  }
  if (view === 'back') return 66 - x;
  return x;
}

export { actionViewX };
