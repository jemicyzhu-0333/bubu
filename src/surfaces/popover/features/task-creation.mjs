'use strict';

import { createPopoverTaskWhenFields } from '../ui/task-when-fields.mjs';
import { createPopoverTaskDraft } from './task-draft.mjs';
import { createPopoverDraftConversation } from './draft-conversation.mjs';

// Composition extracted from the frozen popover entry. Each feature still owns
// its own draft, listeners and lifecycle; this introduces no state writer.
function createPopoverTaskCreation({
  document, $, $$, escapeHTML, syncPressedButtons, readNumberInput, bindStepTitleField,
  parseTagList, tagInputError, estimateInputError, maxSteps, localDateInputValue,
  localDateTimeInputValue, endOfDayISO, scheduledFromDateTimeInput, endOfLocalDateISO,
  formatExpiry, recurrenceIntervalError, autoExpiryPreview, surfaceClient,
  breakdownProviderLabel, fallbackReasonSuffix, fallbackReasonText, restoreModalFocus,
  showTaskFormStatus, stageStuckProposal, isAiClarifyEnabled, showStuckStatus, onMemoryCandidateReview, onPlanningCandidateReview
}) {
  let taskDraft;
  const taskWhenFields = createPopoverTaskWhenFields({
    $, $$, syncPressedButtons, localDateInputValue, localDateTimeInputValue, endOfDayISO,
    scheduledFromDateTimeInput, endOfLocalDateISO, formatExpiry, recurrenceIntervalError,
    autoExpiryPreview, showStatus: source => taskDraft?.showStatus(source)
  });
  taskDraft = createPopoverTaskDraft({
    document, $, $$, escapeHTML, syncPressedButtons, readNumberInput, bindStepTitleField,
    parseTagList, tagInputError, estimateInputError, maxSteps, surfaceClient,
    breakdownProviderLabel, fallbackReasonSuffix, whenFields: taskWhenFields,
    restoreModalFocus, showStatus: showTaskFormStatus
  });
  const draftConversation = createPopoverDraftConversation({
    document, $, escapeHTML, surfaceClient, fallbackReasonText,
    adoptProposal: taskDraft.adopt, stageStuckProposal, restoreModalFocus, onMemoryCandidateReview, onPlanningCandidateReview,
    isAiClarifyEnabled,
    showEntryStatus: (text, purpose) => purpose === 'stuck' ? showStuckStatus(text) : taskDraft.showStatus(text)
  });
  taskDraft.mount();
  draftConversation.mount();
  return Object.freeze({ taskDraft, taskWhenFields, draftConversation });
}

export { createPopoverTaskCreation };
