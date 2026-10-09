'use strict';
const { randomUUID } = require('node:crypto');
// Runtime identity generation is shared by existing task/step workflows and
// reviewed AI changes. Capability transitions still receive it as a narrow port.
function createDomainId(prefix = 'task') { return `${prefix}-${randomUUID()}`; }
module.exports = { createDomainId };
