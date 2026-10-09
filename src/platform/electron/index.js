'use strict';

const { createAppHost } = require('./app-host');
const { createIpcHost } = require('./ipc-host');
const { createNotificationHost } = require('./notifications');
const { createNudgeDelivery } = require('./nudge-delivery');
const { createNudgeHost } = require('./nudge-host');
const { createPermissionHost } = require('./permissions');
const { createPowerHost } = require('./power');
const { createQuickPanelHost } = require('./quick-panel-host');
const { borrowPetForQuickPanel } = require('./quick-panel-pet-cue');
const { createPetMenuExpansion } = require('./pet-menu-expansion');
const { createPetDragSession } = require('./pet-drag-session');
const { resolveFocusDisplay } = require('./focus-display');
const { createScreenHost } = require('./screen-host');
const { createShortcutHost } = require('./shortcuts');
const { createTrayHost } = require('./tray');
const {
  createPopoverWindowHost,
  createImpulseWindowHost,
  createPetWindowHost
} = require('./windows');
const { createPetDevelopment } = require('./dev/pet-development');

module.exports = {
  createAppHost,
  createIpcHost,
  createNotificationHost,
  createNudgeDelivery,
  createNudgeHost,
  createPermissionHost,
  createPowerHost,
  createQuickPanelHost,
  borrowPetForQuickPanel,
  createPetMenuExpansion,
  createPetDragSession,
  resolveFocusDisplay,
  createScreenHost,
  createShortcutHost,
  createTrayHost,
  createPopoverWindowHost,
  createImpulseWindowHost,
  createPetWindowHost,
  createPetDevelopment
};
