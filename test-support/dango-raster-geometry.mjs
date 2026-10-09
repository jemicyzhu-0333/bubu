import { TOOL_SPRITES } from '../src/content/companion/dango-tools.mjs';

export function createDangoRasterFixture({ contactTools = false } = {}) {
  let index = 0;
  const sprite = (rect = [0, 0, 8, 8], extra = {}) => ({ src: `fixture-${index++}.png`, rect, ...extra });
  const view = back => ({
    neutral: sprite([0, 0, 66, 66], { tint: 'body' }), body: sprite([2, 7, 62, 52], { tint: 'body' }),
    parts: {
      'ear-left': sprite([13, 0, 7, 15], { pivot: [17, 13], tint: 'body' }),
      'ear-right': sprite([47, 0, 7, 15], { pivot: [50, 13], tint: 'body' }),
      'foot-left': sprite([13, 55, 15, 9], { pivot: [21, 57], tint: 'body' }),
      'foot-right': sprite([39, 55, 15, 9], { pivot: [46, 57], tint: 'body' }),
      'hand-left': sprite([3, 40, 8, 8], { pivot: [7, 44], tint: 'body' }),
      'hand-right': sprite([55, 40, 8, 8], { pivot: [59, 44], tint: 'body' }),
      arm: sprite([-3, -2, 6, 4], { tint: 'body' })
    },
    anchors: { 'shoulder-left': { x: 7, y: 40 }, 'shoulder-right': { x: 59, y: 40 },
      'foot-left': { x: 21, y: 57 }, 'foot-right': { x: 46, y: 57 } },
    face: back ? null : {
      eyes: Object.fromEntries(['neutral', 'closed', 'curious', 'focused', 'determined', 'content', 'smile', 'wide', 'surprised',
        'sleepy', 'half', 'droopy', 'sparkle', 'pleading', 'shy', 'waiting'].map(name => [name, [
        sprite([19, 24, 5, 7], { pivot: [21.5, 27.5], tint: 'eye' }),
        sprite([43, 24, 5, 7], { pivot: [45.5, 27.5], tint: 'eye' })]])),
      mouth: Object.fromEntries(['neutral', 'closed', 'smile', 'grin', 'open', 'talk', 'surprised', 'chew', 'wavy']
        .map(name => [name, sprite([30, 35, 6, 3], { pivot: [33, 36.5] })]))
    }
  });
  const effects = ['steam', 'energy-rays', 'look-back', 'run-dust', 'soil', 'plane-trail', 'star-glow', 'page', 'ink',
    'scroll', 'keypress', 'water', 'thread', 'food', 'reflection', 'flash', 'hole', 'ellipsis', 'laser', 'headband',
    'ribbon', 'sleep-zzz', 'drowsy-zzz', 'glint'];
  return { id: 'dango-test', version: 1, baseUrl: 'file:///fixture/',
    views: { front: view(false), 'three-quarter': view(false), back: view(true) },
    tools: { ...Object.fromEntries(Object.entries(TOOL_SPRITES).map(([key, value]) => [key, sprite([0, 0, value.width, value.height], { anchors: value.anchors })])),
      ...(contactTools ? { 'small-fin': sprite([0, 0, 8.4, 6.791489361702128], { tint: 'body', anchors: { root: [0, 2.85], grip: [7.4, 3.6] } }),
      'support-paw': sprite([0, 0, 12, 10.415094339622641], { tint: 'body', anchors: { root: [6, .5], sole: [6, 10.415094339622641] } }) } : {}) },
    effects: Object.fromEntries(effects.map(key => [key, sprite([-4, -4, 8, 8])])),
    appearance: { boots: { views: { front: { front: [sprite([13, 55, 15, 9], { attachment: 'foot-left' }),
      sprite([39, 55, 15, 9], { attachment: 'foot-right' })] } } } }
  };
}
