'use strict';

// Preferences owns the stored selection and its bounds. Attention consumes this
// vocabulary through the preferences facade; foreground aliases stay there.
// Defaults apply only when a selection is absent, never to an existing array.
const MAX_NUDGE_WHITELIST_ENTRIES = 100;
const MAX_NUDGE_WHITELIST_ENTRY_LENGTH = 100;
const DEFAULT_WHITELIST = Object.freeze([
  'zoom', 'tencent meeting', '腾讯会议', '钉钉会议', 'dingtalk', 'wechat', '飞书', 'lark',
  'obs', 'quicktime', 'screenflow', 'camtasia',
  'keynote', 'powerpoint', 'teams', 'microsoft teams',
  'game', 'steam'
]);

module.exports = Object.freeze({
  DEFAULT_WHITELIST,
  MAX_NUDGE_WHITELIST_ENTRIES,
  MAX_NUDGE_WHITELIST_ENTRY_LENGTH
});
