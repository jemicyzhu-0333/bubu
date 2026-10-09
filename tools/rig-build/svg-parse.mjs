// Minimal, dependency-free XML reader for layered SVG files. It keeps element
// names, attributes (namespaced ones such as inkscape:label included) and the
// tree; text content is kept only for <style>, which the builder ignores with
// a warning. Good enough for Inkscape, Illustrator, Affinity and Figma exports.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, code) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code] ?? match;
  });
}

function parseAttributes(source, where) {
  const attributes = {};
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1]] = decode(match[3] ?? match[4] ?? '');
  }
  const leftover = source.replace(pattern, '').trim();
  if (leftover && leftover !== '/') throw new SyntaxError(`unreadable attributes near ${where}: ${leftover.slice(0, 40)}`);
  return attributes;
}

function parseSvg(text) {
  if (typeof text !== 'string') throw new TypeError('SVG text is required');
  const root = { name: '#document', attributes: {}, children: [], parent: null };
  let current = root;
  let index = 0;
  const skip = (open, close) => {
    const end = text.indexOf(close, index + open.length);
    if (end < 0) throw new SyntaxError(`unterminated ${open}`);
    index = end + close.length;
  };
  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt < 0) break;
    if (lt > index && current.name === 'style') current.text = (current.text || '') + text.slice(index, lt);
    index = lt;
    if (text.startsWith('<!--', index)) { skip('<!--', '-->'); continue; }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index);
      if (end < 0) throw new SyntaxError('unterminated CDATA');
      if (current.name === 'style') current.text = (current.text || '') + text.slice(index + 9, end);
      index = end + 3;
      continue;
    }
    if (text.startsWith('<?', index)) { skip('<?', '?>'); continue; }
    if (text.startsWith('<!', index)) { skip('<!', '>'); continue; }
    // Attribute values may contain '>' only when quoted; find the real end.
    let end = index + 1;
    let quote = null;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= text.length) throw new SyntaxError('unterminated tag');
    const body = text.slice(index + 1, end);
    index = end + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      if (name !== current.name) throw new SyntaxError(`mismatched </${name}>, expected </${current.name}>`);
      current = current.parent;
      continue;
    }
    const selfClosing = body.endsWith('/');
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) throw new SyntaxError('empty tag');
    const element = {
      name: nameMatch[1],
      attributes: parseAttributes(body.slice(nameMatch[1].length).replace(/\/$/, ''), nameMatch[1]),
      children: [], parent: current
    };
    current.children.push(element);
    if (!selfClosing) current = element;
  }
  if (current !== root) throw new SyntaxError(`unclosed <${current.name}>`);
  const svg = root.children.find(child => child.name === 'svg');
  if (!svg) throw new SyntaxError('no <svg> root element');
  return svg;
}

export { parseSvg, decode };
