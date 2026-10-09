'use strict';

// ARCHITECTURE「AI 与 LLM」: public static contracts, without Provider runtime.
// Re-export the existing identities; this entry owns no alternate validators.
const { COLLABORATION_TASK, validateCollaborationResult, validateTaskDraft } = require('./collaboration-task');

module.exports = Object.freeze({ COLLABORATION_TASK, validateCollaborationResult, validateTaskDraft });
