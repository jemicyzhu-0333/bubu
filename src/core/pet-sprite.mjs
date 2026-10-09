'use strict';

// 离屏 sprite 缓存。
//
// 身体过去是每帧 22×22 = 484 次独立 fillRect。只要当前变换含非整数分量
// （translate(0, sin(phase*2)*2)、rotate、scale 都会产生），每个 3×3 格子的边缘
// 就会被反锯齿；相邻格子按 source-over 合成后，接缝像素的 alpha 只有约
// 0.83 + 0.17×(1-0.83) ≈ 0.86。在透明置顶窗口上，这 14% 的透明度就是一条
// 能看见桌面的裂缝，而且随正弦相位上下/左右游走 —— 肉眼看到的“割裂”。
//
// 成熟做法是把身体先画进离屏 sprite，再用一次 drawImage 贴出去：一次绘制
// 内部不存在接缝，旋转与缩放也只在轮廓上产生抗锯齿。本模块只负责缓存这些
// sprite（表情、眨眼、皮肤、状态的组合数量有限），绘制内容仍由 renderer 决定，
// 因此可以注入假 surface 做单测。
function createPetSpriteCache(options = {}) {
  const createSurface = options.createSurface;
  if (typeof createSurface !== 'function') throw new TypeError('createSurface is required');
  const capacity = Math.max(1, Math.floor(options.capacity === undefined ? 24 : options.capacity));

  // Map 保持插入顺序，命中时重新插入即可得到 LRU 淘汰顺序。
  const entries = new Map();

  function acquire(key, request = {}) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('key must be a non-empty string');
    if (typeof request.paint !== 'function') throw new TypeError('paint must be a function');
    const width = Math.max(1, Math.floor(request.width));
    const height = Math.max(1, Math.floor(request.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError('width and height must be finite');

    const cached = entries.get(key);
    // 尺寸变化意味着设备像素比或舞台几何变了，旧位图不能再按 1:1 贴出去。
    if (cached && cached.width === width && cached.height === height) {
      entries.delete(key);
      entries.set(key, cached);
      return cached.surface;
    }

    const surface = createSurface(width, height);
    request.paint(surface, width, height);
    entries.set(key, { surface, width, height });
    while (entries.size > capacity) entries.delete(entries.keys().next().value);
    return surface;
  }

  function clear() {
    entries.clear();
  }

  return {
    acquire,
    clear,
    get size() { return entries.size; },
    get capacity() { return capacity; }
  };
}

// 渲染进程以 classic <script> 共享全局词法作用域加载本文件，
// 顶层标识符必须是本文件专属，否则同页面的后续脚本会在编译期整体失败。
const petSpriteApi = { createPetSpriteCache };



export default petSpriteApi;
export { createPetSpriteCache };
