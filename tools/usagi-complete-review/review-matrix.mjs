// Deliberately finite visual review set. Never a claim about the wardrobe power set.
export const USAGI_INTERACTION_PAIRS = Object.freeze([
  ['crown-daisy', ['tiny-crown', 'daisy-clip'], 'happy-hop'],
  ['sunhat-sprout', ['sunhat', 'sprout-clip'], 'happy-hop'],
  ['moon-beret-bow', ['moon-beret', 'ear-bow'], 'happy-hop'],
  ['garden-beret-sakura', ['garden-beret', 'sakura-clip'], 'happy-hop'],
  ['scarf-starlit-cape', ['pastel-scarf', 'starlit-cape'], 'wave'],
  ['petal-rain-cape', ['petal-collar', 'rain-cape'], 'wave'],
  ['collar-apron', ['star-collar', 'garden-apron'], 'wave'],
  ['rain-cape-envelope', ['rain-cape', 'envelope-pouch'], 'umbrella-dance'],
  ['apron-rain-bag', ['garden-apron', 'rain-satchel'], 'umbrella-dance'],
  ['travel-cape-seed', ['travel-cape', 'seed-pouch'], 'umbrella-dance'],
  ['halo-moon-beret', ['halo', 'moon-beret'], 'happy-hop'],
  ['constellation-crown', ['constellation', 'tiny-crown'], 'happy-hop'],
  ['moon-boots-travel-cape', ['moon-boots', 'travel-cape'], 'moonwalk'],
  ['soft-boots-rain-cape', ['soft-boots', 'rain-cape'], 'moonwalk']
].map(([id, ids, action]) => Object.freeze({
  id: `pair-${id}`, itemIds: Object.freeze(ids.map(id => `usagi.${id}`)), action
})));
