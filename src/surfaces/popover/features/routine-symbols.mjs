'use strict';

const KIND_LABELS = Object.freeze({
  medication: { icon: '<span data-icon="capsule" data-icon-only aria-hidden="true"></span>', label: '吃药' },
  stimulant: { icon: '<span data-icon="cup" data-icon-only aria-hidden="true"></span>', label: '咖啡因' },
  meal: { icon: '<span data-icon="apple" data-icon-only aria-hidden="true"></span>', label: '正餐' },
  snack: { icon: '<span data-icon="apple" data-icon-only aria-hidden="true"></span>', label: '加餐' },
  movement: { icon: '<span data-icon="bolt" data-icon-only aria-hidden="true"></span>', label: '活动' },
  rest: { icon: '<span data-icon="moon" data-icon-only aria-hidden="true"></span>', label: '休息' },
  meeting: { icon: '<span data-icon="message" data-icon-only aria-hidden="true"></span>', label: '会议' },
  custom: { icon: '<span data-icon="flag" data-icon-only aria-hidden="true"></span>', label: '自定义' }
});

function routineSymbol(kind) {
  return KIND_LABELS[kind] || { icon: '<span data-icon="flag" data-icon-only aria-hidden="true"></span>', label: '日常' };
}

export { KIND_LABELS, routineSymbol };
