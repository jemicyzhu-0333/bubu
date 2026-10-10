'use strict';

// Styling recipes, not unlock bundles or a second equipment state. Each look
// names compatible existing choices; no recipe is ever applied automatically.
const outfit = (id, label, itemIds) => Object.freeze({ id, label, formId: 'usagi', itemIds: Object.freeze(itemIds) });

const USAGI_OUTFIT_SETS = Object.freeze([
  outfit('sun-garden', '晴日园丁', [
    'usagi.garden-beret', 'usagi.daisy-clip', 'usagi.petal-collar', 'usagi.seed-pouch',
    'usagi.garden-apron', 'usagi.garden-clogs'
  ]),
  outfit('rain-walk', '雨后散步', [
    'usagi.ear-bow', 'usagi.pastel-scarf', 'usagi.rain-cape', 'usagi.rain-boots', 'usagi.rain-satchel'
  ]),
  outfit('moon-post', '月色邮差', [
    'usagi.moon-beret', 'usagi.star-collar', 'usagi.starlit-cape',
    'usagi.envelope-pouch', 'usagi.constellation', 'usagi.moon-boots'
  ])
]);

export { USAGI_OUTFIT_SETS };
