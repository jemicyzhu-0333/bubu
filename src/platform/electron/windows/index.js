'use strict';

const { createPopoverWindowHost } = require('./popover-window');
const { createImpulseWindowHost } = require('./impulse-window');
const { createPetWindowHost } = require('./pet-window');

module.exports = {
  createPopoverWindowHost,
  createImpulseWindowHost,
  createPetWindowHost
};
