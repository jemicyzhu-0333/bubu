// Application chrome keeps a stable identity independently of companion skins.
// One accent marks the primary action and selection (PRODUCT「界面语言」). The five
// category inks exist only so the day timeline can tell focus, completions, routines,
// reminders and mood notes apart; each is muted and readable as text (≥ 4.5:1).
const palettes = Object.freeze({
  light: { bg0: '#efeeeb', bg1: '#faf9f6', bg2: '#ffffff', bg3: '#e8e5e0',
    fg0: '#26282b', fg1: '#44474b', fg2: '#68696c', primary: '#a54460', primaryDark: '#90394f',
    primaryInk: '#953d55', ink: '#ffffff',
    cyanInk: '#1d6670', greenInk: '#3b662c', blueInk: '#34548f', purpleInk: '#674790', yellowInk: '#6e5210' },
  dark: { bg0: '#202224', bg1: '#27292c', bg2: '#303236', bg3: '#3b3d41',
    fg0: '#f2f0ed', fg1: '#dedbd6', fg2: '#b2b1b0', primary: '#e8a0b2', primaryDark: '#f0b5c3',
    primaryInk: '#e8a0b2', ink: '#27292c',
    cyanInk: '#86cdd6', greenInk: '#a9cd93', blueInk: '#a6bcec', purpleInk: '#c8afea', yellowInk: '#dfc47f' }
});
function panelPalette(appearance) {
  const base = palettes[appearance] || palettes.dark;
  return { ...base, accent: base.primary, accentDark: base.primaryDark, accentInk: base.primaryInk };
}
export { panelPalette };
