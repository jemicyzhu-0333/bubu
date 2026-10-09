'use strict';

function nextRovingIndex(currentIndex, key, count, orientation = 'both') {
  if (!Number.isInteger(count) || count < 1) return null;
  const current = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < count
    ? currentIndex
    : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if ((orientation === 'both' || orientation === 'horizontal') && key === 'ArrowRight') {
    return (current + 1) % count;
  }
  if ((orientation === 'both' || orientation === 'horizontal') && key === 'ArrowLeft') {
    return (current - 1 + count) % count;
  }
  if ((orientation === 'both' || orientation === 'vertical') && key === 'ArrowDown') {
    return (current + 1) % count;
  }
  if ((orientation === 'both' || orientation === 'vertical') && key === 'ArrowUp') {
    return (current - 1 + count) % count;
  }
  return null;
}

function focusTrapTargetIndex(activeIndex, count, shiftKey = false) {
  if (!Number.isInteger(count) || count < 1) return null;
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= count) {
    return shiftKey ? count - 1 : 0;
  }
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;
  return null;
}

// ESM 同时提供默认 API 与具名导出；两种导入方式复用相同的纯导航函数。
const keyboardNavigationApi = { nextRovingIndex, focusTrapTargetIndex };



export default keyboardNavigationApi;
export { nextRovingIndex, focusTrapTargetIndex };
