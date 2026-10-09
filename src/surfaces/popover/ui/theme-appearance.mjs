'use strict';

// 浅色 / 深色 / 跟随系统由 canonical preferences 与共享 interface presentation 驱动。面板配色来自
// ui/panel-palette.mjs，与伙伴皮肤无关（PRODUCT「界面语言」）；这里只剩把配色写到根元素的变量表，
// 以及测试与配色共用的 WCAG 对比度计算。
const parse = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

const linear = value => {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const [r, g, b] = parse(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// 配色里的键 → 根元素上的 CSS 变量。
const THEME_VARIABLES = Object.freeze({
  primary: '--primary', primaryDark: '--primary-dark', accent: '--accent', accentDark: '--accent-dark',
  bg0: '--bg-0', bg1: '--bg-1', bg2: '--bg-2', bg3: '--bg-3',
  fg0: '--fg-0', fg1: '--fg-1', fg2: '--fg-2',
  primaryInk: '--primary-ink', accentInk: '--accent-ink', ink: '--ink',
  cyanInk: '--cyan-ink', greenInk: '--green-ink', blueInk: '--blue-ink', purpleInk: '--purple-ink', yellowInk: '--yellow-ink'
});

export { THEME_VARIABLES, contrastRatio };
