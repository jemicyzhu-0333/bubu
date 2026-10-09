'use strict';

const FOOD_IDS = Object.freeze([
  'basic', 'fish', 'bone', 'donut', 'coffee', 'carrot', 'mushroom',
  'rice', 'milk', 'berry', 'cake'
]);

const PET_STATES = Object.freeze([
  'idle', 'sleeping', 'focused', 'resting', 'celebrating',
  'dragged', 'walking', 'hungry', 'talking', 'peeking'
]);

module.exports = { FOOD_IDS, PET_STATES };
