'use strict';

const { createPopoverWindowHost } = require('./popover-window');
const { createImpulseWindowHost, registerImpulseWindowIpc } = require('./impulse-window');
const { createPetWindowHost } = require('./pet-window');

module.exports = {
  createPopoverWindowHost,
  createImpulseWindowHost, registerImpulseWindowIpc,
  createPetWindowHost
};
