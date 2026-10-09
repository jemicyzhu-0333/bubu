'use strict';

const petScenesApi = (() => {

function scene(id, name, periods, feature, sky, ground, emitters = [], accents = []) {
  return { id, name, periods, feature, sky, ground, emitters, accents };
}

const SCENES = Object.freeze({
  'dawn-window': scene('dawn-window', '晨曦窗边', ['morning'], 'window', ['#ffd6a5', '#f5a7b8'], '#5a4055', [
    { type: 'cloud', chance: 0.018, max: 4, colors: ['#fff2dc', '#f5d9dd'], speed: 0.16 },
    { type: 'bird', chance: 0.004, max: 2, colors: ['#5f6b87'], speed: 1.0 }
  ], ['#ffe09b']),
  'rainy-window': scene('rainy-window', '雨滴玻璃', ['morning', 'afternoon', 'evening'], 'window', ['#61738f', '#34435d'], '#283347', [
    { type: 'rain', chance: 0.28, max: 70, colors: ['#8fc7e8', '#b5dff5'], speed: 2.8 },
    { type: 'mist', chance: 0.018, max: 8, colors: ['#b7c9dc'], speed: 0.12 }
  ], ['#7dcfff']),
  'sunny-desk': scene('sunny-desk', '晴日书桌', ['morning', 'forenoon'], 'desk', ['#9fdcff', '#e8f6ff'], '#a77a52', [
    { type: 'dust', chance: 0.08, max: 25, colors: ['#ffe29a', '#ffffff'], speed: 0.08 },
    { type: 'sparkle', chance: 0.012, max: 8, colors: ['#fff1a8'], speed: 0.18 }
  ], ['#ffd558', '#9ece6a']),
  'morning-library': scene('morning-library', '晨间书房', ['morning', 'forenoon'], 'library', ['#7996b4', '#d9bc8c'], '#5b3d2e', [
    { type: 'dust', chance: 0.07, max: 28, colors: ['#e7c98f'], speed: 0.06 },
    { type: 'page', chance: 0.003, max: 2, colors: ['#f4e5c3'], speed: 0.35 }
  ], ['#c9986a', '#e0af68']),
  'garden-breeze': scene('garden-breeze', '庭院微风', ['morning', 'forenoon', 'noon'], 'garden', ['#a7ddc4', '#dff4cf'], '#557a46', [
    { type: 'leaf', chance: 0.035, max: 22, colors: ['#9ece6a', '#6aa55a', '#d8e88b'], speed: 0.55 },
    { type: 'butterfly', chance: 0.008, max: 4, colors: ['#f7768e', '#e0af68', '#bb9af7'], speed: 0.45 }
  ], ['#9ece6a', '#f7768e']),
  'coffee-shop': scene('coffee-shop', '咖啡小店', ['forenoon', 'noon', 'afternoon'], 'cafe', ['#bd906c', '#725246'], '#49352e', [
    { type: 'steam', chance: 0.05, max: 14, colors: ['#f4e9dc', '#d9c9bd'], speed: 0.34 },
    { type: 'note', chance: 0.006, max: 5, colors: ['#e0af68', '#f7768e'], speed: 0.28 }
  ], ['#e0af68', '#c9986a']),
  'lunch-park': scene('lunch-park', '午间公园', ['noon'], 'park', ['#7dcfff', '#d4f4c7'], '#6a9b52', [
    { type: 'butterfly', chance: 0.018, max: 7, colors: ['#f7768e', '#e0af68', '#bb9af7'], speed: 0.55 },
    { type: 'petal', chance: 0.025, max: 18, colors: ['#ffb3c8', '#fff0a8'], speed: 0.52 }
  ], ['#9ece6a', '#ffd558']),
  'cloud-terrace': scene('cloud-terrace', '云上露台', ['noon', 'afternoon'], 'terrace', ['#73c7ef', '#d8f3ff'], '#6f7e94', [
    { type: 'cloud', chance: 0.026, max: 7, colors: ['#ffffff', '#dcecff'], speed: 0.23 },
    { type: 'plane', chance: 0.003, max: 1, colors: ['#f5f7ff'], speed: 1.3 }
  ], ['#c0caf5']),
  'afternoon-studio': scene('afternoon-studio', '午后工作室', ['afternoon'], 'studio', ['#e6b887', '#d48976'], '#594052', [
    { type: 'dust', chance: 0.09, max: 32, colors: ['#ffe0a8', '#f8c98c'], speed: 0.07 },
    { type: 'sparkle', chance: 0.009, max: 7, colors: ['#ffcf78'], speed: 0.16 }
  ], ['#bb9af7', '#e0af68']),
  'summer-storm': scene('summer-storm', '夏日阵雨', ['afternoon', 'evening'], 'storm', ['#53647c', '#26354c'], '#26323d', [
    { type: 'rain', chance: 0.34, max: 84, colors: ['#7dcfff', '#aacbea'], speed: 3.4 },
    { type: 'flash', chance: 0.0015, max: 1, colors: ['#f4ecb8'], speed: 0 }
  ], ['#7dcfff', '#e0af68']),
  'sunset-rooftop': scene('sunset-rooftop', '落日天台', ['evening'], 'rooftop', ['#ff9a6c', '#ad6e9b'], '#34334a', [
    { type: 'bird', chance: 0.005, max: 4, colors: ['#333044'], speed: 0.82 },
    { type: 'dragonfly', chance: 0.006, max: 4, colors: ['#d7a6e8'], speed: 0.42 }
  ], ['#ff7a5c', '#bb9af7']),
  'train-window': scene('train-window', '归途列车', ['evening', 'night'], 'train', ['#bd7f78', '#36415c'], '#262a38', [
    { type: 'light', chance: 0.06, max: 24, colors: ['#ffd558', '#f7768e', '#7dcfff'], speed: 1.5 },
    { type: 'rain', chance: 0.06, max: 24, colors: ['#8fb7d8'], speed: 2.2 }
  ], ['#e0af68']),
  'city-evening': scene('city-evening', '城市初灯', ['evening'], 'city', ['#655b86', '#27334f'], '#1f2638', [
    { type: 'light', chance: 0.035, max: 20, colors: ['#ffd558', '#f7768e', '#7dcfff'], speed: 0.25 },
    { type: 'plane', chance: 0.002, max: 1, colors: ['#dce4ff'], speed: 1.0 }
  ], ['#ffd558', '#7dcfff']),
  'cozy-room': scene('cozy-room', '暖灯房间', ['evening', 'night'], 'room', ['#755366', '#332d46'], '#3c2f3b', [
    { type: 'dust', chance: 0.045, max: 20, colors: ['#f2c879'], speed: 0.05 },
    { type: 'steam', chance: 0.025, max: 8, colors: ['#ead7c4'], speed: 0.26 }
  ], ['#e0af68', '#f7768e']),
  'night-city': scene('night-city', '霓虹夜城', ['night', 'lateNight'], 'neon', ['#20274c', '#111427'], '#12121e', [
    { type: 'light', chance: 0.045, max: 28, colors: ['#f7768e', '#7dcfff', '#bb9af7'], speed: 0.18 },
    { type: 'rain', chance: 0.1, max: 40, colors: ['#526f9a'], speed: 2.1 }
  ], ['#f7768e', '#7dcfff']),
  'moon-balcony': scene('moon-balcony', '月光阳台', ['night'], 'moon', ['#272b59', '#15172e'], '#20273b', [
    { type: 'star', chance: 0.05, max: 20, colors: ['#c0caf5', '#e0af68', '#bb9af7'], speed: 0 },
    { type: 'firefly', chance: 0.02, max: 8, colors: ['#e0af68', '#9ece6a'], speed: 0.18 }
  ], ['#c0caf5', '#bb9af7']),
  'star-camp': scene('star-camp', '星空营地', ['night', 'lateNight'], 'camp', ['#171c3c', '#090b20'], '#18251f', [
    { type: 'star', chance: 0.075, max: 30, colors: ['#ffffff', '#e0af68', '#7dcfff'], speed: 0 },
    { type: 'ember', chance: 0.06, max: 18, colors: ['#ff7a5c', '#e0af68'], speed: 0.7 }
  ], ['#ff7a5c', '#e0af68']),
  'late-night-desk': scene('late-night-desk', '深夜书桌', ['lateNight'], 'lateDesk', ['#20243c', '#11131f'], '#2c2631', [
    { type: 'dust', chance: 0.035, max: 15, colors: ['#d5b477'], speed: 0.04 },
    { type: 'star', chance: 0.035, max: 12, colors: ['#c0caf5'], speed: 0 }
  ], ['#e0af68', '#c0caf5']),
  aurora: scene('aurora', '极光夜', ['night', 'lateNight'], 'aurora', ['#17294a', '#12142d'], '#172d2c', [
    { type: 'starDust', chance: 0.1, max: 38, colors: ['#7dcfff', '#9ece6a', '#bb9af7'], speed: 0.08 },
    { type: 'shootingStar', chance: 0.002, max: 2, colors: ['#ffffff'], speed: 2.0 }
  ], ['#7dcfff', '#9ece6a', '#bb9af7']),
  'snowy-window': scene('snowy-window', '落雪窗前', ['morning', 'evening', 'night', 'lateNight'], 'snow', ['#6d7899', '#27304c'], '#e8edf5', [
    { type: 'snow', chance: 0.16, max: 55, colors: ['#ffffff', '#dce7f5', '#b9c9e4'], speed: 0.55 },
    { type: 'steam', chance: 0.025, max: 8, colors: ['#ffffff'], speed: 0.22 }
  ], ['#ffffff', '#7dcfff']),
  'ocean-window': scene('ocean-window', '海底舷窗', ['morning', 'noon', 'afternoon', 'night'], 'ocean', ['#237da0', '#102e59'], '#0d2944', [
    { type: 'bubble', chance: 0.11, max: 42, colors: ['rgba(180,235,255,0.8)', 'rgba(125,207,255,0.75)'], speed: 0.72 },
    { type: 'fish', chance: 0.006, max: 5, colors: ['#e0af68', '#f7768e', '#9ece6a'], speed: 0.52 }
  ], ['#7dcfff', '#9ece6a']),
  'forest-clearing': scene('forest-clearing', '森林空地', ['morning', 'forenoon', 'afternoon', 'evening'], 'forest', ['#75a983', '#294f3e'], '#27412f', [
    { type: 'leaf', chance: 0.055, max: 30, colors: ['#9ece6a', '#528b41', '#d1dc75'], speed: 0.52 },
    { type: 'firefly', chance: 0.018, max: 10, colors: ['#e0af68'], speed: 0.16 }
  ], ['#9ece6a', '#528b41']),
  'sakura-lane': scene('sakura-lane', '樱花小径', ['morning', 'noon', 'afternoon', 'evening'], 'sakura', ['#ffc4d6', '#c99fc5'], '#76556f', [
    { type: 'petal', chance: 0.11, max: 52, colors: ['#ffb3c8', '#ffe1eb', '#f7768e'], speed: 0.62 },
    { type: 'sparkle', chance: 0.015, max: 8, colors: ['#ffffff'], speed: 0.12 }
  ], ['#ffb3c8', '#f7768e']),
  'pixel-arcade': scene('pixel-arcade', '像素游戏厅', ['evening', 'night', 'lateNight'], 'arcade', ['#29204d', '#111125'], '#171528', [
    { type: 'pixel', chance: 0.07, max: 32, colors: ['#f7768e', '#7dcfff', '#9ece6a', '#e0af68'], speed: 0.42 },
    { type: 'sparkle', chance: 0.025, max: 12, colors: ['#ffffff'], speed: 0.2 }
  ], ['#f7768e', '#7dcfff', '#9ece6a']),
  'robot-lab': scene('robot-lab', '机器人实验室', ['forenoon', 'afternoon', 'night'], 'lab', ['#27344c', '#141927'], '#1c2630', [
    { type: 'codeRain', chance: 0.06, max: 24, colors: ['#7dcfff', '#9ece6a'], speed: 1.1 },
    { type: 'sparkle', chance: 0.015, max: 9, colors: ['#7dcfff'], speed: 0.18 }
  ], ['#7dcfff', '#a9b1d6'])
});

const SCENE_SCHEDULE = Object.freeze({
  morning: ['sunny-desk', 'dawn-window', 'morning-library', 'garden-breeze'],
  forenoon: ['sunny-desk', 'morning-library', 'garden-breeze', 'coffee-shop'],
  noon: ['cloud-terrace', 'garden-breeze', 'coffee-shop', 'lunch-park'],
  afternoon: ['afternoon-studio', 'cloud-terrace', 'forest-clearing', 'coffee-shop'],
  evening: ['cozy-room', 'sunset-rooftop', 'city-evening', 'forest-clearing'],
  night: ['cozy-room', 'moon-balcony', 'star-camp'],
  lateNight: ['late-night-desk', 'star-camp']
});

// High-density rain, lightning, neon and novelty scenes remain available only
// after the user explicitly chooses “换风景”; none can flash on startup.
const SCENE_MANUAL_SCHEDULE = Object.freeze({
  morning: ['sunny-desk', 'dawn-window', 'morning-library', 'garden-breeze', 'snowy-window', 'ocean-window'],
  forenoon: ['sunny-desk', 'morning-library', 'garden-breeze', 'coffee-shop', 'robot-lab'],
  noon: ['cloud-terrace', 'garden-breeze', 'coffee-shop', 'lunch-park', 'ocean-window', 'sakura-lane'],
  afternoon: ['afternoon-studio', 'cloud-terrace', 'forest-clearing', 'coffee-shop', 'rainy-window', 'summer-storm', 'robot-lab'],
  evening: ['cozy-room', 'sunset-rooftop', 'city-evening', 'forest-clearing', 'train-window', 'snowy-window', 'summer-storm'],
  night: ['cozy-room', 'moon-balcony', 'night-city', 'star-camp', 'aurora', 'pixel-arcade', 'ocean-window'],
  lateNight: ['late-night-desk', 'star-camp', 'aurora', 'night-city', 'pixel-arcade']
});

const SKIN_SCENE_PREFERENCES = Object.freeze({
  forest: ['forest-clearing', 'garden-breeze'], ocean: ['ocean-window', 'cloud-terrace'],
  sakura: ['sakura-lane', 'dawn-window'], moon: ['moon-balcony', 'aurora'],
  flame: ['star-camp', 'sunset-rooftop'], crown: ['city-evening', 'sunset-rooftop'],
  robot: ['robot-lab', 'pixel-arcade'], woodsman: ['forest-clearing', 'morning-library'],
  bat: ['night-city', 'moon-balcony']
});

function validateSceneLibrary(scenes = SCENES, schedule = SCENE_SCHEDULE) {
  const ids = Object.keys(scenes);
  if (ids.length < 20) throw new RangeError('at least 20 background scenes are required');
  for (const [id, value] of Object.entries(scenes)) {
    if (!value || value.id !== id || !value.name || !Array.isArray(value.periods) || !value.periods.length) {
      throw new TypeError(`invalid scene: ${id}`);
    }
    if (!Array.isArray(value.sky) || value.sky.length !== 2 || !Array.isArray(value.emitters)) {
      throw new TypeError(`invalid scene visuals: ${id}`);
    }
  }
  for (const [period, sceneIds] of Object.entries(schedule)) {
    if (!sceneIds.length || sceneIds.some(id => !scenes[id] || !scenes[id].periods.includes(period))) {
      throw new TypeError(`invalid scene schedule: ${period}`);
    }
  }
  return { sceneCount: ids.length, periodCount: Object.keys(schedule).length };
}

const SCENE_STATS = Object.freeze(validateSceneLibrary());
validateSceneLibrary(SCENES, SCENE_MANUAL_SCHEDULE);

return {
  SCENES,
  SCENE_SCHEDULE,
  SCENE_MANUAL_SCHEDULE,
  SCENE_STATS,
  SKIN_SCENE_PREFERENCES,
  validateSceneLibrary
};

})();

export default petScenesApi;
export const SCENES = petScenesApi.SCENES;
export const SCENE_SCHEDULE = petScenesApi.SCENE_SCHEDULE;
export const SCENE_MANUAL_SCHEDULE = petScenesApi.SCENE_MANUAL_SCHEDULE;
export const SCENE_STATS = petScenesApi.SCENE_STATS;
export const SKIN_SCENE_PREFERENCES = petScenesApi.SKIN_SCENE_PREFERENCES;
export const validateSceneLibrary = petScenesApi.validateSceneLibrary;
