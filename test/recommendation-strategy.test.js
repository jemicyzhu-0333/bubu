'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  recommendationEaseScore,
  selectRecommendationCandidates
} = require('../src/core/recommendation-strategy');

function candidate(id, options = {}) {
  return {
    id,
    title: id,
    score: options.score ?? 0,
    task: {
      id,
      title: id,
      deadline: options.deadline ?? null,
      createdAt: options.createdAt ?? 0
    },
    estimatedMinutes: options.estimatedMinutes ?? 25,
    recommendedStartMinutes: options.recommendedStartMinutes ?? 15,
    scoreBreakdown: {
      activation: options.activation ?? 5,
      durationFit: options.durationFit ?? 8,
      nextStep: options.nextStep ?? 0,
      energyMatch: options.energyMatch ?? 7
    },
    signals: { needsTriage: options.needsTriage === true }
  };
}

test('selects a distinct priority choice and approachable choice without mutating ranking', () => {
  const ranked = [
    candidate('urgent-but-hard', {
      score: 90, activation: -6, durationFit: -4, energyMatch: -16,
      estimatedMinutes: 120, recommendedStartMinutes: 25
    }),
    candidate('easy', {
      score: 45, activation: 12, durationFit: 12, nextStep: 10,
      energyMatch: 18, estimatedMinutes: 8, recommendedStartMinutes: 5
    }),
    candidate('medium', { score: 60, estimatedMinutes: 25 })
  ];
  const snapshot = JSON.stringify(ranked);

  const selected = selectRecommendationCandidates(ranked, 2);

  assert.deepEqual(selected.map(item => item.id), ['urgent-but-hard', 'easy']);
  assert.deepEqual(selected.map(item => item.role), ['综合优先', '最容易开始']);
  assert.deepEqual(selected.map(item => item.strategy), ['priority', 'ease']);
  assert.equal(JSON.stringify(ranked), snapshot);
});

test('ease scoring is explainable and penalizes triage or unnecessary startup load', () => {
  const approachable = candidate('approachable', {
    activation: 12, nextStep: 10, estimatedMinutes: 10, recommendedStartMinutes: 2
  });
  const longer = candidate('longer', {
    activation: 12, nextStep: 10, estimatedMinutes: 60, recommendedStartMinutes: 25
  });
  const expired = candidate('expired', {
    activation: 12, nextStep: 10, estimatedMinutes: 10, recommendedStartMinutes: 2,
    needsTriage: true
  });

  assert.ok(recommendationEaseScore(approachable) > recommendationEaseScore(longer));
  assert.ok(recommendationEaseScore(approachable) > recommendationEaseScore(expired));
});

test('selection is deterministic, bounded to two, and handles duplicate identities', () => {
  const ranked = [
    candidate('same', { score: 80 }),
    candidate('same', { score: 70, activation: 12 }),
    candidate('other', { score: 60, activation: 5 })
  ];
  const first = selectRecommendationCandidates(ranked, 20);
  const second = selectRecommendationCandidates(ranked, 20);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map(item => item.id), ['same', 'other']);
  assert.equal(selectRecommendationCandidates(ranked, 1).length, 1);
  assert.deepEqual(selectRecommendationCandidates([], 2), []);
  assert.deepEqual(selectRecommendationCandidates(null, 2), []);
});

test('fully tied candidates use a locale-independent code-unit ID order', () => {
  const ranked = [candidate('éclair'), candidate('zebra'), candidate('任务')];

  const selected = selectRecommendationCandidates(ranked, 2);

  assert.deepEqual(selected.map(item => item.id), ['zebra', 'éclair']);
});

test('does not mislabel a runner-up when the priority winner is also easiest', () => {
  const both = candidate('both', {
    score: 100, activation: 12, durationFit: 12, nextStep: 10,
    energyMatch: 18, estimatedMinutes: 5, recommendedStartMinutes: 2
  });
  const runnerUp = candidate('runner-up', {
    score: 80, activation: 5, durationFit: 3,
    energyMatch: 4, estimatedMinutes: 25, recommendedStartMinutes: 15
  });

  const selected = selectRecommendationCandidates([runnerUp, both], 2);

  assert.deepEqual(selected.map(item => item.id), ['both', 'runner-up']);
  assert.equal(selected[0].role, '综合优先 · 同时最容易开始');
  assert.equal(selected[0].strategy, 'priority-and-ease');
  assert.equal(selected[1].role, '另一个较易开始');
  assert.equal(selected[1].strategy, 'ease-alternative');
});

test('finds the true ease winner across the complete candidate pool', () => {
  const candidates = Array.from({ length: 25 }, (_, index) => candidate(`task-${index}`, {
    score: 100 - index,
    activation: index === 24 ? 12 : -6,
    durationFit: index === 24 ? 12 : -4,
    nextStep: index === 24 ? 10 : 0,
    energyMatch: index === 24 ? 18 : -16,
    estimatedMinutes: index === 24 ? 5 : 120,
    recommendedStartMinutes: index === 24 ? 2 : 25,
    createdAt: index
  }));

  const selected = selectRecommendationCandidates(candidates, 2);

  assert.deepEqual(selected.map(item => item.id), ['task-0', 'task-24']);
  assert.equal(selected[1].role, '最容易开始');
});
