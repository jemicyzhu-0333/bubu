'use strict';

// Reviewed reminder copy for the nudge surfaces. Every line offers the break or
// the next step as available rather than owed, so a reminder the user ignores
// still reads as an invitation instead of a scolding.
const CHARACTERS = {
  spider: {
    name: 'Peter',
    lines: {
      rest: [
        "Hello, I'm Peter Parker.",
        "A short break is available if you want it.",
        "Even Spider-Man can pause without earning it.",
        "You could stretch now, or choose another gentle reset."
      ],
      focus: [
        "Ready for one small next step?",
        "You do not need to finish everything right now.",
        "I can stay while you begin."
      ]
    }
  },
  cat: {
    name: 'Mochi',
    lines: {
      rest: [
        "Meow~ 想动一动的话，我陪你喵",
        "喵~ 要不要喝口水？",
        "眼睛累了，可以看看远处喵",
        "可以伸个懒腰，也可以继续坐一会儿"
      ],
      focus: [
        "喵~ 只做眼前这一小步",
        "本喵安静陪着你...",
        "Focus mode: 慢慢来"
      ]
    }
  },
  robot: {
    name: 'BEEP',
    lines: {
      rest: [
        "SYSTEM: 检测到可选休息窗口",
        "建议: 准备好时执行 rest()",
        "提示: 眼睛也许想看看远处",
        "BEEP — 可以选择一个舒服的休息"
      ],
      focus: [
        "SYSTEM: 专注模块已就绪",
        "可以先降低一个干扰",
        "等待你选择下一步..."
      ]
    }
  }
};

for (const character of Object.values(CHARACTERS)) {
  for (const pool of Object.values(character.lines)) Object.freeze(pool);
  Object.freeze(character.lines);
  Object.freeze(character);
}
Object.freeze(CHARACTERS);

const DEFAULT_CHARACTER_ID = 'spider';
const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTERS));

// A saved character can disappear across versions and a reminder must still be
// able to speak, so an unknown id falls back to the default rather than
// producing an empty line pool. `rest` is the fallback tone because it is the
// one that never pressures.
function reminderLines(characterId, type) {
  const character = CHARACTERS[characterId] || CHARACTERS[DEFAULT_CHARACTER_ID];
  return character.lines[type] || character.lines.rest;
}

module.exports = { CHARACTERS, CHARACTER_IDS, DEFAULT_CHARACTER_ID, reminderLines };
