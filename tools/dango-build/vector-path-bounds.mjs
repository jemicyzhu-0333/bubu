// Analytic native-path bounds. Curves are evaluated at derivative roots;
// control polygons and logical-pixel raster approximations are not used.
const EPS = 1e-10;
const TAU = Math.PI * 2;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const ARITY = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, C: 6, S: 4, A: 7, Z: 0 };
const modulo = value => (value % TAU + TAU) % TAU;
function exactVectorPathBounds(d, matrix = IDENTITY) {
  const tokens = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const point = ([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  function addWorld(p) { b.minX = Math.min(b.minX, p[0]); b.minY = Math.min(b.minY, p[1]); b.maxX = Math.max(b.maxX, p[0]); b.maxY = Math.max(b.maxY, p[1]); }
  const add = p => addWorld(point(p));
  function bezier(points) {
    const p = points.map(point), cubic = p.length === 4;
    const value = t => [0, 1].map(k => cubic
      ? (1 - t) ** 3 * p[0][k] + 3 * (1 - t) ** 2 * t * p[1][k] + 3 * (1 - t) * t * t * p[2][k] + t ** 3 * p[3][k]
      : (1 - t) ** 2 * p[0][k] + 2 * (1 - t) * t * p[1][k] + t * t * p[2][k]);
    addWorld(p[0]); addWorld(p.at(-1));
    for (let axis = 0; axis < 2; axis++) {
      let roots;
      if (!cubic) roots = [(p[0][axis] - p[1][axis]) / (p[0][axis] - 2 * p[1][axis] + p[2][axis])];
      else {
        const a = -p[0][axis] + 3 * p[1][axis] - 3 * p[2][axis] + p[3][axis];
        const c = p[1][axis] - p[0][axis], q = 2 * (p[0][axis] - 2 * p[1][axis] + p[2][axis]);
        const discriminant = q * q - 4 * a * c;
        roots = Math.abs(a) < EPS ? [-c / q] : discriminant < 0 ? [] : [(-q + Math.sqrt(discriminant)) / (2 * a), (-q - Math.sqrt(discriminant)) / (2 * a)];
      }
      for (const t of roots) if (Number.isFinite(t) && t > 0 && t < 1) addWorld(value(t));
    }
  }
  function arc(from, to, args) {
    let [rx, ry, degrees, large, sweep] = args; rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx < EPS || ry < EPS || Math.hypot(to[0] - from[0], to[1] - from[1]) < EPS) { add(from); add(to); return; }
    const phi = degrees * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi);
    const dx = (from[0] - to[0]) / 2, dy = (from[1] - to[1]) / 2;
    const x = c * dx + s * dy, y = -s * dx + c * dy;
    const ratio = x * x / (rx * rx) + y * y / (ry * ry);
    if (ratio > 1) { const scale = Math.sqrt(ratio); rx *= scale; ry *= scale; }
    const denominator = rx * rx * y * y + ry * ry * x * x;
    const coefficient = (Boolean(large) === Boolean(sweep) ? -1 : 1)
      * Math.sqrt(Math.max(0, (rx * rx * ry * ry - denominator) / denominator));
    const cx = coefficient * rx * y / ry, cy = -coefficient * ry * x / rx;
    const center = [c * cx - s * cy + (from[0] + to[0]) / 2, s * cx + c * cy + (from[1] + to[1]) / 2];
    const u = [(x - cx) / rx, (y - cy) / ry], v = [(-x - cx) / rx, (-y - cy) / ry];
    const start = Math.atan2(u[1], u[0]);
    let span = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
    if (sweep && span < 0) span += TAU;
    if (!sweep && span > 0) span -= TAU;
    const a = [rx * c, rx * s], e = [-ry * s, ry * c], origin = point(center);
    const cosine = [matrix[0] * a[0] + matrix[2] * a[1], matrix[1] * a[0] + matrix[3] * a[1]];
    const sine = [matrix[0] * e[0] + matrix[2] * e[1], matrix[1] * e[0] + matrix[3] * e[1]];
    const at = angle => origin.map((value, k) => value + cosine[k] * Math.cos(angle) + sine[k] * Math.sin(angle));
    add(from); add(to);
    for (let axis = 0; axis < 2; axis++) for (const angle of [Math.atan2(sine[axis], cosine[axis]), Math.atan2(sine[axis], cosine[axis]) + Math.PI]) {
      if ((span >= 0 ? modulo(angle - start) : modulo(start - angle)) <= Math.abs(span) + EPS) addWorld(at(angle));
    }
  }
  let index = 0, command, previous = null, current = [0, 0], start = [0, 0], control = null;
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    const kind = command?.toUpperCase();
    if (!(kind in ARITY)) throw new Error('unsupported native path command');
    if (kind === 'Z') { add(start); current = start.slice(); previous = kind; control = null; command = null; continue; }
    const values = tokens.slice(index, index + ARITY[kind]).map(Number);
    if (values.length !== ARITY[kind] || values.some(value => !Number.isFinite(value))) throw new Error('incomplete native path');
    index += ARITY[kind]; const base = command === kind ? [0, 0] : current;
    const pair = at => [values[at] + base[0], values[at + 1] + base[1]];
    let end, nextControl = null;
    if (kind === 'M' || kind === 'L') { end = pair(0); add(end); if (kind === 'M') { start = end.slice(); command = command === kind ? 'L' : 'l'; } }
    else if (kind === 'H') { end = [base[0] + values[0], current[1]]; add(end); }
    else if (kind === 'V') { end = [current[0], base[1] + values[0]]; add(end); }
    else if (kind === 'Q' || kind === 'T') {
      nextControl = kind === 'Q' ? pair(0) : ['Q', 'T'].includes(previous) ? current.map((n, k) => 2 * n - control[k]) : current;
      end = pair(kind === 'Q' ? 2 : 0); bezier([current, nextControl, end]);
    } else if (kind === 'C' || kind === 'S') {
      const first = kind === 'C' ? pair(0) : ['C', 'S'].includes(previous) ? current.map((n, k) => 2 * n - control[k]) : current;
      nextControl = pair(kind === 'C' ? 2 : 0); end = pair(kind === 'C' ? 4 : 2); bezier([current, first, nextControl, end]);
    } else { end = pair(5); arc(current, end, values); }
    current = end; previous = kind; control = nextControl;
  }
  return Number.isFinite(b.minX) ? b : null;
}
function exactVectorShapeBounds(shape) {
  if (shape.opacity === 0 || shape.fill === 'none' && shape.stroke === 'none') return null;
  const m = shape.m || IDENTITY, b = exactVectorPathBounds(shape.d, m);
  if (!b) return null;
  if (shape.stroke && shape.stroke !== 'none' && shape.width > 0) {
    if (shape.cap !== 'round' || shape.join !== 'round') throw new Error('native wardrobe bounds require rounded caps and joins');
    const radius = shape.width / 2, x = radius * Math.hypot(m[0], m[2]), y = radius * Math.hypot(m[1], m[3]);
    b.minX -= x; b.maxX += x; b.minY -= y; b.maxY += y;
  }
  return b;
}
export { exactVectorPathBounds, exactVectorShapeBounds };
