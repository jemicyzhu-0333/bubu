'use strict';

import { validateRig } from './schema.mjs';

// A form's rig arrives as a statically imported module (`export default null`
// until the owner builds one). Validation runs once, lazily; a rig for another
// form, an invalid document, or a surface without Path2D all resolve to null
// and report an explicit source status. Usagi never substitutes retired artwork.
function createRigSource(document, { form, canPaint = () => typeof Path2D === 'function' } = {}) {
  let status = null;
  let rig = null;

  function evaluate() {
    if (status) return;
    if (document === null || document === undefined) { status = Object.freeze({ state: 'absent', errors: [] }); return; }
    const result = validateRig(document);
    if (!result.ok) { status = Object.freeze({ state: 'invalid', errors: result.errors }); return; }
    if (form && result.rig.form !== form) {
      status = Object.freeze({ state: 'invalid', errors: Object.freeze([`rig is for form ${result.rig.form}`]) });
      return;
    }
    rig = result.rig;
    status = Object.freeze({ state: 'ready', errors: Object.freeze([]) });
  }

  function get() {
    evaluate();
    return rig && canPaint() ? rig : null;
  }

  function describe() {
    evaluate();
    if (status.state === 'ready' && !canPaint()) return Object.freeze({ state: 'unsupported', errors: [] });
    return status;
  }

  return Object.freeze({ get, describe });
}

export { createRigSource };
export default Object.freeze({ createRigSource });
