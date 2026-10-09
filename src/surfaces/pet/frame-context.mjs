'use strict';

const contentSnapshots = new WeakMap();

function copyFrameData(value) {
  if (Array.isArray(value)) return value.map(copyFrameData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyFrameData(item)]));
}

function freezeFrameData(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeFrameData(item);
  return Object.freeze(value);
}

function contentSnapshot(content) {
  if (!content || typeof content !== 'object') return content;
  if (!contentSnapshots.has(content)) contentSnapshots.set(content, freezeFrameData(copyFrameData(content)));
  return contentSnapshots.get(content);
}

function createPetFrameContext({ state, now, dt, wallNow, policy, stage, content }) {
  if (![now, dt, wallNow].every(Number.isFinite) || dt < 0) throw new TypeError('frame clocks must be finite');
  return Object.freeze({
    now, dt, wallNow,
    state: freezeFrameData(copyFrameData(state)),
    policy: freezeFrameData(copyFrameData(policy)),
    stage: freezeFrameData(copyFrameData(stage)),
    content: contentSnapshot(content)
  });
}

export { copyFrameData, freezeFrameData, createPetFrameContext };
