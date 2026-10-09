// ================================================================
// 小步 — skins:一份定义,主进程 require,面板作为 classic script 读 window。
// 每个皮肤 = 像素兽调色板 + 界面主题。
// 面板曾经自己抄了一份调色板（“mirror of main.js”),两份十六进制靠人眼对齐;
// 现在只有这一份,改一次颜色两边同时变。
// ================================================================

const SKINS = {
  pink: {
    name: '粉粉兽',
    unlockDesc: '默认皮肤',
    palette: {
      focus:     { 1:'#1a1b26', 2:'#f7768e', 3:'#c53b53', 4:'#1a1b26' },
      idle:      { 1:'#1a1b26', 2:'#f7768e', 3:'#c53b53', 4:'#1a1b26' },
      break:     { 1:'#1a1b26', 2:'#9ece6a', 3:'#528b41', 4:'#1a1b26' },
      celebrate: { 1:'#1a1b26', 2:'#e0af68', 3:'#c07f26', 4:'#1a1b26' },
      tired:     { 1:'#1a1b26', 2:'#565f89', 3:'#414868', 4:'#1a1b26' }
    },
    theme: {
      primary: '#f7768e', primaryDark: '#c53b53',
      accent: '#e0af68', accentDark: '#c07f26',
      bg0: '#16161e', bg1: '#1a1b26', bg2: '#24283b', bg3: '#2f334d',
      fg0: '#c0caf5', fg1: '#a9b1d6', fg2: '#565f89'
    }
  },
  forest: {
    name: '森林兽',
    unlockDesc: 'Lv.3 解锁',
    palette: {
      focus:     { 1:'#0f1a12', 2:'#9ece6a', 3:'#528b41', 4:'#0f1a12' },
      idle:      { 1:'#0f1a12', 2:'#73daca', 3:'#41a6b5', 4:'#0f1a12' },
      break:     { 1:'#0f1a12', 2:'#9ece6a', 3:'#528b41', 4:'#0f1a12' },
      celebrate: { 1:'#0f1a12', 2:'#e0af68', 3:'#c07f26', 4:'#0f1a12' },
      tired:     { 1:'#0f1a12', 2:'#565f89', 3:'#414868', 4:'#0f1a12' }
    },
    theme: {
      primary: '#9ece6a', primaryDark: '#528b41',
      accent: '#73daca', accentDark: '#41a6b5',
      bg0: '#0a120c', bg1: '#0f1a12', bg2: '#1c2a1e', bg3: '#2a3d2e',
      fg0: '#d5e8c4', fg1: '#a8c69a', fg2: '#5e7860'
    }
  },
  ocean: {
    name: '深海兽',
    unlockDesc: 'Lv.5 解锁',
    palette: {
      focus:     { 1:'#0a1421', 2:'#7dcfff', 3:'#3d59a1', 4:'#0a1421' },
      idle:      { 1:'#0a1421', 2:'#7aa2f7', 3:'#3d59a1', 4:'#0a1421' },
      break:     { 1:'#0a1421', 2:'#73daca', 3:'#41a6b5', 4:'#0a1421' },
      celebrate: { 1:'#0a1421', 2:'#e0af68', 3:'#c07f26', 4:'#0a1421' },
      tired:     { 1:'#0a1421', 2:'#565f89', 3:'#414868', 4:'#0a1421' }
    },
    theme: {
      primary: '#7dcfff', primaryDark: '#3d59a1',
      accent: '#7aa2f7', accentDark: '#3d59a1',
      bg0: '#06101e', bg1: '#0a1421', bg2: '#152238', bg3: '#22355a',
      fg0: '#c8e0ff', fg1: '#8fa9d0', fg2: '#4a6280'
    }
  },
  sakura: {
    name: '樱花兽',
    unlockDesc: 'Lv.7 解锁 · 飘落花瓣',
    petEffect: 'petals',
    palette: {
      focus:     { 1:'#2a1a24', 2:'#ffb3c8', 3:'#f7768e', 4:'#2a1a24' },
      idle:      { 1:'#2a1a24', 2:'#ffb3c8', 3:'#f7768e', 4:'#2a1a24' },
      break:     { 1:'#2a1a24', 2:'#c8e6a0', 3:'#9ece6a', 4:'#2a1a24' },
      celebrate: { 1:'#2a1a24', 2:'#ffd5e0', 3:'#f7768e', 4:'#2a1a24' },
      tired:     { 1:'#2a1a24', 2:'#565f89', 3:'#414868', 4:'#2a1a24' }
    },
    theme: {
      primary: '#ffb3c8', primaryDark: '#f7768e',
      accent: '#ffd5e0', accentDark: '#f7768e',
      bg0: '#1e0f18', bg1: '#2a1a24', bg2: '#3d2534', bg3: '#553549',
      fg0: '#ffe0ea', fg1: '#d5a8bd', fg2: '#7d5a70'
    }
  },
  moon: {
    name: '月光兽',
    unlockDesc: 'Lv.6 解锁 · 会发光',
    palette: {
      focus:     { 1:'#0f0a1a', 2:'#bb9af7', 3:'#7a5ed6', 4:'#0f0a1a' },
      idle:      { 1:'#0f0a1a', 2:'#bb9af7', 3:'#7a5ed6', 4:'#0f0a1a' },
      break:     { 1:'#0f0a1a', 2:'#9ece6a', 3:'#528b41', 4:'#0f0a1a' },
      celebrate: { 1:'#0f0a1a', 2:'#e0af68', 3:'#c07f26', 4:'#0f0a1a' },
      tired:     { 1:'#0f0a1a', 2:'#565f89', 3:'#414868', 4:'#0f0a1a' }
    },
    theme: {
      primary: '#bb9af7', primaryDark: '#7a5ed6',
      accent: '#c8b3f5', accentDark: '#7a5ed6',
      bg0: '#080510', bg1: '#0f0a1a', bg2: '#1c1230', bg3: '#2d1f4a',
      fg0: '#e2d5ff', fg1: '#a89bc9', fg2: '#5a4d78'
    }
  },
  flame: {
    name: '火焰兽',
    unlockDesc: 'Lv.4 解锁',
    palette: {
      focus:     { 1:'#1a0a0a', 2:'#ff7a5c', 3:'#c53b1a', 4:'#1a0a0a' },
      idle:      { 1:'#1a0a0a', 2:'#ff9a6c', 3:'#c53b1a', 4:'#1a0a0a' },
      break:     { 1:'#1a0a0a', 2:'#e0af68', 3:'#c07f26', 4:'#1a0a0a' },
      celebrate: { 1:'#1a0a0a', 2:'#ffcc5c', 3:'#e0af68', 4:'#1a0a0a' },
      tired:     { 1:'#1a0a0a', 2:'#565f89', 3:'#414868', 4:'#1a0a0a' }
    },
    theme: {
      primary: '#ff7a5c', primaryDark: '#c53b1a',
      accent: '#ffcc5c', accentDark: '#e0af68',
      bg0: '#0f0505', bg1: '#1a0a0a', bg2: '#2d1512', bg3: '#4a2520',
      fg0: '#ffddc8', fg1: '#c99e8a', fg2: '#7d5a50'
    }
  },
  crown: {
    name: '王冠兽',
    unlockDesc: 'Lv.10 解锁 · 头顶皇冠',
    palette: {
      focus:     { 1:'#1a1408', 2:'#ffd558', 3:'#c07f26', 4:'#1a1408' },
      idle:      { 1:'#1a1408', 2:'#ffe58a', 3:'#c07f26', 4:'#1a1408' },
      break:     { 1:'#1a1408', 2:'#9ece6a', 3:'#528b41', 4:'#1a1408' },
      celebrate: { 1:'#1a1408', 2:'#ffcc5c', 3:'#e0af68', 4:'#1a1408' },
      tired:     { 1:'#1a1408', 2:'#565f89', 3:'#414868', 4:'#1a1408' }
    },
    theme: {
      primary: '#ffd558', primaryDark: '#c07f26',
      accent: '#ffe58a', accentDark: '#c07f26',
      bg0: '#0f0a04', bg1: '#1a1408', bg2: '#2a2010', bg3: '#453520',
      fg0: '#fff2c8', fg1: '#c9b48a', fg2: '#7d6a4a'
    }
  },
  robot: {
    name: '机器兽',
    unlockDesc: 'Lv.10 解锁 · 像素电路',
    palette: {
      focus:     { 1:'#0a0a12', 2:'#a9b1d6', 3:'#565f89', 4:'#7dcfff' },
      idle:      { 1:'#0a0a12', 2:'#a9b1d6', 3:'#565f89', 4:'#7dcfff' },
      break:     { 1:'#0a0a12', 2:'#9ece6a', 3:'#528b41', 4:'#7dcfff' },
      celebrate: { 1:'#0a0a12', 2:'#e0af68', 3:'#c07f26', 4:'#7dcfff' },
      tired:     { 1:'#0a0a12', 2:'#565f89', 3:'#414868', 4:'#3d59a1' }
    },
    theme: {
      primary: '#7dcfff', primaryDark: '#3d59a1',
      accent: '#a9b1d6', accentDark: '#565f89',
      bg0: '#05050a', bg1: '#0a0a12', bg2: '#15152a', bg3: '#252540',
      fg0: '#d0d5f0', fg1: '#8f95b8', fg2: '#4a4e70'
    }
  },
  woodsman: {
    name: '樵夫兽',
    unlockDesc: 'Lv.7 解锁',
    palette: {
      focus:     { 1:'#1a1208', 2:'#c9986a', 3:'#8a5a2a', 4:'#1a1208' },
      idle:      { 1:'#1a1208', 2:'#d9a878', 3:'#8a5a2a', 4:'#1a1208' },
      break:     { 1:'#1a1208', 2:'#9ece6a', 3:'#528b41', 4:'#1a1208' },
      celebrate: { 1:'#1a1208', 2:'#e0af68', 3:'#c07f26', 4:'#1a1208' },
      tired:     { 1:'#1a1208', 2:'#565f89', 3:'#414868', 4:'#1a1208' }
    },
    theme: {
      primary: '#c9986a', primaryDark: '#8a5a2a',
      accent: '#e0af68', accentDark: '#c07f26',
      bg0: '#0f0904', bg1: '#1a1208', bg2: '#2a1e12', bg3: '#453520',
      fg0: '#e8d4b8', fg1: '#c9a888', fg2: '#7d6248'
    }
  },
  bat: {
    name: '夜行兽',
    unlockDesc: 'Lv.8 解锁',
    palette: {
      focus:     { 1:'#050508', 2:'#3d59a1', 3:'#1a1b26', 4:'#f7768e' },
      idle:      { 1:'#050508', 2:'#414868', 3:'#1a1b26', 4:'#f7768e' },
      break:     { 1:'#050508', 2:'#9ece6a', 3:'#528b41', 4:'#f7768e' },
      celebrate: { 1:'#050508', 2:'#bb9af7', 3:'#7a5ed6', 4:'#f7768e' },
      tired:     { 1:'#050508', 2:'#565f89', 3:'#414868', 4:'#f7768e' }
    },
    theme: {
      primary: '#f7768e', primaryDark: '#c53b53',
      accent: '#bb9af7', accentDark: '#7a5ed6',
      bg0: '#020204', bg1: '#050508', bg2: '#0d0d15', bg3: '#1a1a25',
      fg0: '#d0d5e0', fg1: '#8a90a0', fg2: '#454858'
    }
  },
  usagi: {
    name: '乌沙奇 2.0',
    formId: 'usagi',
    unlockDesc: '默认可用 · 长耳形态与专属动作',
    palette: {
      focus:     { 1:'#473b40', 2:'#fff2dc', 3:'#ebd6be', 4:'#342b34' },
      idle:      { 1:'#473b40', 2:'#fff2dc', 3:'#ebd6be', 4:'#342b34' },
      break:     { 1:'#473b40', 2:'#fff2dc', 3:'#ebd6be', 4:'#342b34' },
      celebrate: { 1:'#473b40', 2:'#fff2dc', 3:'#ebd6be', 4:'#342b34' },
      tired:     { 1:'#473b40', 2:'#fff2dc', 3:'#ebd6be', 4:'#342b34' }
    },
    theme: {
      primary: '#f3a9bc', primaryDark: '#b7758f',
      accent: '#8ed7ce', accentDark: '#579f98',
      bg0: '#19171f', bg1: '#25222c', bg2: '#34303c', bg3: '#47414d',
      fg0: '#fff2e3', fg1: '#dac9c1', fg2: '#a3939a'
    }
  }
};

// 与 task-dates.js 同一套双模式导出:主进程 require 拿 module.exports,
// 面板作为 classic script 加载时挂到 globalThis(浏览器里就是 window)。

export default { SKINS };
export { SKINS };
