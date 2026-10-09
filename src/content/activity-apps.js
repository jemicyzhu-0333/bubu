'use strict';

// Which foreground or audible apps mean what for the companion mirror
// (ARCHITECTURE「活动镜像」). macOS identifiers are bundle IDs; Windows identifiers
// are process names without `.exe`. Matching is case-insensitive and a trailing `*`
// matches a prefix. This table is the only place an app is named; nothing else in
// the product keeps or reports which app was seen.
const ACTIVITY_APPS = Object.freeze({
  // Chat apps whose whole purpose is talking to a model.
  ai: Object.freeze({
    darwin: Object.freeze(['com.anthropic.claudefordesktop', 'com.openai.chat']),
    win32: Object.freeze(['claude', 'chatgpt'])
  }),
  // Editors, IDEs (AI IDEs included: without an agent hook they read as coding) and terminals.
  coding: Object.freeze({
    darwin: Object.freeze([
      'com.microsoft.vscode', 'com.microsoft.vscodeinsiders', 'com.vscodium', 'com.todesktop.230313mzl4w4u92',
      'com.exafunction.windsurf', 'com.jetbrains.*', 'com.apple.dt.xcode', 'dev.zed.zed', 'com.sublimetext.*',
      'com.panic.nova', 'com.apple.terminal', 'com.googlecode.iterm2', 'dev.warp.warp*', 'com.mitchellh.ghostty',
      'net.kovidgoyal.kitty', 'com.github.wez.wezterm', 'org.alacritty', 'co.zeit.hyper'
    ]),
    win32: Object.freeze([
      'code', 'code - insiders', 'codium', 'cursor', 'windsurf', 'idea64', 'pycharm64', 'webstorm64', 'goland64',
      'clion64', 'rider64', 'phpstorm64', 'rubymine64', 'datagrip64', 'studio64', 'devenv', 'sublime_text', 'zed',
      'windowsterminal', 'wezterm-gui', 'alacritty', 'hyper', 'warp'
    ])
  }),
  // Dedicated music players. Browsers and meeting apps are deliberately absent: a call
  // or a video must never make the companion dance.
  music: Object.freeze({
    darwin: Object.freeze([
      'com.spotify.client', 'com.apple.music', 'com.netease.163music', 'com.tencent.qqmusicmac', 'com.kugou.mac.*',
      'com.tidal.desktop', 'com.coppertino.vox', 'com.amazon.music', 'com.deezer.deezer-desktop', 'com.foobar2000.mac'
    ]),
    win32: Object.freeze([
      'spotify', 'cloudmusic', 'qqmusic', 'kugou', 'kwmusic', 'applemusic', 'foobar2000', 'tidal', 'aimp',
      'musicbee', 'amazon music', 'deezer'
    ])
  })
});

module.exports = { ACTIVITY_APPS };
