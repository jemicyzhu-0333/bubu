'use strict';

const petSceneArtApi = (() => {
// 场景的静态美术层。坐标以 220×220 桌宠舞台为基准；生产端和离屏取帧端
// 共享这一份实现。动态粒子仍由 renderer 的时间轴管理。

const SCENE_VIEW = Object.freeze({ x: 20, y: 30, width: 180, height: 142, floorY: 140 });

function rect(context, color, x, y, width, height) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}

function drawMoon(context, x, y, size, color) {
  context.fillStyle = color;
  context.fillRect(x, y, size, size);
  context.fillRect(x + 2, y - 2, size - 4, 2);
  context.fillRect(x + 2, y + size, size - 4, 2);
  context.fillRect(x - 2, y + 2, 2, size - 4);
  context.fillRect(x + size, y + 2, 2, size - 4);
  context.clearRect(x + size - 6, y + 2, 5, 5);
  context.clearRect(x + 3, y + size - 8, 4, 4);
}

function drawCloud(context, x, y, size, color) {
  rect(context, color, x, y, size, 4);
  rect(context, color, x + 2, y - 3, size - 4, 3);
  rect(context, color, x + 6, y - 6, size - 12, 3);
  rect(context, color, x - 2, y + 4, size + 4, 2);
}

function drawFish(context, x, y, color, direction = 1) {
  rect(context, color, x, y, 8, 4);
  rect(context, color, x + (direction > 0 ? -3 : 8), y + 1, 3, 2);
  rect(context, '#1a1b26', x + (direction > 0 ? 6 : 1), y + 1, 1, 1);
}

function drawFeature(context, scene) {
  const accent = scene.accents[0] || '#e0af68';
  const accent2 = scene.accents[1] || '#7dcfff';
  const feature = scene.feature;
  if (feature === 'window' || feature === 'snow') {
    rect(context, '#292b3a', 35, 28, 150, 8); rect(context, '#292b3a', 35, 36, 6, 92);
    rect(context, '#292b3a', 179, 36, 6, 92); rect(context, '#292b3a', 35, 122, 150, 6);
    rect(context, 'rgba(255,255,255,0.28)', 106, 36, 4, 86);
  }
  if (['desk', 'studio', 'lateDesk'].includes(feature)) {
    rect(context, '#3a2c35', 28, 125, 164, 10); rect(context, '#29212c', 43, 135, 8, 37); rect(context, '#29212c', 169, 135, 8, 37);
    rect(context, '#202331', 64, 65, 76, 48); rect(context, accent2, 69, 70, 66, 35);
    rect(context, '#202331', 97, 113, 10, 12); rect(context, accent, 151, 77, 7, 35); rect(context, accent, 143, 76, 22, 5);
  } else if (feature === 'library') {
    for (const y of [42, 76, 110]) rect(context, '#4b352c', 25, y, 170, 5);
    const colors = ['#c9986a', '#7aa2f7', '#9ece6a', '#f7768e', '#e0af68'];
    for (let i = 0; i < 23; i++) rect(context, colors[i % colors.length], 29 + (i % 8) * 20, 25 + Math.floor(i / 8) * 34, 8 + (i % 3) * 2, 15 + (i % 4) * 3);
  } else if (['garden', 'park', 'forest', 'sakura'].includes(feature)) {
    const leaf = feature === 'sakura' ? '#ffb3c8' : accent;
    for (const x of [35, 70, 155, 185]) {
      rect(context, '#5b4533', x, 91, 6, 55); rect(context, leaf, x - 15, 55, 36, 36); rect(context, leaf, x - 7, 43, 22, 22);
    }
    rect(context, 'rgba(255,255,255,0.35)', 95, 45, 30, 58);
  } else if (feature === 'cafe' || feature === 'room') {
    rect(context, '#3e2d31', 48, 113, 124, 8); rect(context, '#3e2d31', 62, 121, 6, 38); rect(context, '#3e2d31', 152, 121, 6, 38);
    rect(context, accent, 145, 43, 28, 20); rect(context, accent, 157, 63, 5, 35);
    rect(context, '#f4e9dc', 80, 101, 21, 12); rect(context, '#9a6655', 83, 104, 15, 8);
  } else if (feature === 'terrace' || feature === 'rooftop') {
    rect(context, '#30364a', 20, 119, 180, 6); rect(context, '#30364a', 28, 99, 5, 45); rect(context, '#30364a', 187, 99, 5, 45);
    for (let x = 38; x < 187; x += 20) rect(context, '#30364a', x, 105, 3, 28);
    if (feature === 'rooftop') { rect(context, accent, 145, 45, 25, 25); rect(context, '#30364a', 142, 70, 31, 3); }
  } else if (feature === 'storm') {
    for (let x = 15; x < 210; x += 34) drawCloud(context, x, 42 + (x % 3) * 8, 31, '#3b4359');
    rect(context, accent, 150, 65, 4, 28); rect(context, accent, 141, 89, 13, 4); rect(context, accent, 141, 89, 4, 20);
  } else if (feature === 'train') {
    rect(context, '#252b3d', 28, 25, 164, 112); rect(context, '#66708b', 35, 32, 150, 96);
    rect(context, '#252b3d', 106, 32, 6, 96); rect(context, '#252b3d', 35, 96, 150, 5);
    rect(context, accent, 43, 74, 34, 4); rect(context, accent2, 145, 58, 27, 3);
  } else if (feature === 'city' || feature === 'neon') {
    const colors = feature === 'neon' ? ['#30365f', '#512d63', '#203c55'] : ['#35405a', '#2d344d', '#41445f'];
    for (let i = 0; i < 8; i++) {
      const height = 35 + (i * 17) % 65; const x = 17 + i * 24;
      rect(context, colors[i % colors.length], x, 142 - height, 20, height);
      for (let y = 142 - height + 8; y < 137; y += 13) rect(context, i % 2 ? accent : accent2, x + 5, y, 3, 4);
    }
  } else if (feature === 'moon') {
    drawMoon(context, 150, 30, 27, '#d9ddff'); rect(context, '#2d354c', 20, 128, 180, 7);
    for (let x = 25; x < 200; x += 25) rect(context, '#2d354c', x, 107, 3, 36);
  } else if (feature === 'camp') {
    rect(context, '#596047', 0, 124, 220, 35); rect(context, '#8f5964', 45, 89, 62, 45);
    context.fillStyle = '#e0af68'; context.beginPath(); context.moveTo(45, 89); context.lineTo(76, 54); context.lineTo(107, 89); context.fill();
    // 即使 Reduce Motion 清空动态星尘/火星，“星空营地”仍有可辨识的静态星空与营火。
    for (const [x, y] of [[28, 43], [56, 31], [119, 39], [145, 25], [188, 48], [201, 30]]) {
      rect(context, x % 2 ? accent : accent2, x, y, 2, 2);
    }
    rect(context, '#4b352c', 148, 136, 24, 4); rect(context, '#4b352c', 153, 132, 14, 3);
    rect(context, '#ff7a5c', 154, 119, 12, 16); rect(context, '#e0af68', 158, 112, 6, 20);
  } else if (feature === 'aurora') {
    context.globalAlpha *= 0.7;
    for (let i = 0; i < 4; i++) {
      context.strokeStyle = [accent, accent2, '#bb9af7', '#9ece6a'][i];
      context.lineWidth = 7 - i;
      context.beginPath(); context.moveTo(15, 45 + i * 14); context.bezierCurveTo(70, 5 + i * 15, 135, 95 - i * 8, 205, 35 + i * 12); context.stroke();
    }
  } else if (feature === 'ocean') {
    for (let x = 24; x < 205; x += 26) { rect(context, x % 3 ? '#3f846b' : '#62a36d', x, 112, 4, 45); rect(context, '#62a36d', x - 4, 119, 8, 3); }
    drawFish(context, 48, 55, accent, 1); drawFish(context, 166, 86, accent2, -1);
  } else if (feature === 'arcade') {
    for (const x of [28, 82, 136]) { rect(context, '#25213d', x, 55, 43, 87); rect(context, accent2, x + 6, 63, 31, 27); rect(context, accent, x + 11, 104, 7, 7); rect(context, '#9ece6a', x + 25, 105, 5, 5); }
  } else if (feature === 'lab') {
    rect(context, '#202b38', 25, 35, 170, 103); rect(context, accent2, 40, 52, 60, 42); rect(context, '#17202b', 45, 57, 50, 32);
    for (let x = 112; x < 183; x += 17) { rect(context, accent, x, 58, 3, 48); rect(context, accent2, x + 3, 82, 10, 3); }
  }
  context.globalAlpha = 1;
}

function drawBackdrop(context, scene, options = {}) {
  if (!context || !scene) return;
  const [skyTop, skyBottom] = scene.sky;
  context.save();
  context.globalAlpha = options.calmVisual ? 0.32 : 0.58;
  const sky = context.createLinearGradient(0, SCENE_VIEW.y, 0, SCENE_VIEW.y + SCENE_VIEW.height);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(1, skyBottom);
  context.fillStyle = sky;
  context.fillRect(SCENE_VIEW.x, SCENE_VIEW.y, SCENE_VIEW.width, SCENE_VIEW.height);
  context.fillStyle = scene.ground;
  context.fillRect(SCENE_VIEW.x, SCENE_VIEW.floorY, SCENE_VIEW.width, 32);
  drawFeature(context, scene);
  context.restore();
}

function drawSessionBackdrop(context, mode, activity, options = {}) {
  const focused = mode === 'focused';
  const top = focused ? '#1d2a3b' : '#29263d';
  const bottom = focused ? '#18202e' : '#1f2032';
  const floor = focused ? '#2c3040' : '#343044';
  const accent = focused ? '#7dcfff' : '#bb9af7';
  const muted = focused ? '#33445b' : '#4a405d';
  const gradient = context.createLinearGradient(0, SCENE_VIEW.y, 0, SCENE_VIEW.floorY);
  gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(SCENE_VIEW.x, SCENE_VIEW.y, SCENE_VIEW.width, SCENE_VIEW.height);
  rect(context, floor, SCENE_VIEW.x, SCENE_VIEW.floorY, SCENE_VIEW.width, 32);
  rect(context, muted, 29, 44, 45, 47); rect(context, '#111724', 34, 49, 35, 37);
  rect(context, accent, 50, 49, 2, 37); rect(context, accent, 34, 66, 35, 2);
  rect(context, '#3a3040', 35, 131, 150, 7); rect(context, '#251f2a', 48, 138, 7, 33); rect(context, '#251f2a', 166, 138, 7, 33);
  if (focused) {
    rect(context, '#202638', 146, 54, 36, 29); rect(context, '#40546c', 151, 59, 26, 17);
    rect(context, accent, 155, 63, 15, 2); rect(context, accent, 155, 69, 9, 2);
    rect(context, '#d8bd75', 78, 51, 5, 55); rect(context, '#e0af68', 69, 49, 23, 5);
  } else {
    context.fillStyle = '#d9ddff'; context.beginPath(); context.arc(51, 65, 10, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#111724'; context.beginPath(); context.arc(56, 61, 10, 0, Math.PI * 2); context.fill();
    rect(context, '#6c5b77', 143, 116, 37, 14); rect(context, '#8a7197', 148, 111, 27, 10);
    if (!options.calmVisual && activity && activity.motion === 'daydream') {
      rect(context, 'rgba(255,255,255,0.5)', 151, 60, 3, 3); rect(context, 'rgba(255,255,255,0.35)', 160, 52, 5, 5);
    }
  }
}

return Object.freeze({
  SCENE_VIEW,
  drawBackdrop,
  drawFeature,
  drawSessionBackdrop
});

})();

export default petSceneArtApi;
export const SCENE_VIEW = petSceneArtApi.SCENE_VIEW;
export const drawBackdrop = petSceneArtApi.drawBackdrop;
export const drawFeature = petSceneArtApi.drawFeature;
export const drawSessionBackdrop = petSceneArtApi.drawSessionBackdrop;
