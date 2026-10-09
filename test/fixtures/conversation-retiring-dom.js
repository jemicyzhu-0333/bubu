'use strict';

// Static synthetic DOM, not browser/layout evidence. Existing selector inventory
// checked against popover.html SHA256 6ed4c377c9a8a038bc3724195faba006fa2ef6d6b7b34c1fcac473165aa3ea39.
// No runtime markup read and no production source rewriting.
const INITIAL_CLASSES = Object.freeze({
  "shrinkNextAction": [
    "pixel-input"
  ],
  "btnOpenDraftChat": [
    "pixel-btn",
    "btn-mini"
  ],
  "draftChatMask": [
    "modal-mask",
    "hidden"
  ],
  "draftChatTitle": [
    "modal-title"
  ],
  "draftChatCurrentMode": [
    "sr-only"
  ],
  "draftChatTaskContext": [
    "hidden"
  ],
  "draftChatClose": [
    "modal-close"
  ],
  "draftChatConversationControls": [],
  "draftChatDescription": [],
  "draftChatMode": [
    "pixel-input"
  ],
  "draftChatModeNote": [
    "hidden"
  ],
  "draftChatRetention": [
    "pixel-input"
  ],
  "draftChatSaveState": [],
  "draftChatRetentionConfirm": [
    "chat-disclosure",
    "hidden"
  ],
  "btnDraftChatRetentionConfirm": [
    "pixel-btn",
    "btn-mini"
  ],
  "btnDraftChatRetentionKeep": [
    "pixel-btn",
    "btn-mini"
  ],
  "draftChatRetentionOptions": [
    "chat-disclosure",
    "hidden"
  ],
  "draftChatRetentionDays": [
    "pixel-input"
  ],
  "draftChatPinned": [],
  "draftChatDisclosure": [
    "chat-disclosure"
  ],
  "draftChatDisclosureText": [],
  "draftChatProvider": [],
  "draftChatFocusSummary": [],
  "draftChatPlanningPreferences": [],
  "draftChatContextPicker": [
    "hidden"
  ],
  "draftChatContextKind": [],
  "draftChatContextSearch": [
    "pixel-input"
  ],
  "btnDraftChatContextSearch": [
    "pixel-btn",
    "btn-mini"
  ],
  "draftChatContextChoices": [
    "chat-context-choices"
  ],
  "btnDraftChatContextMore": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "draftChatScopeSelection": [],
  "draftChatScopePending": [],
  "btnDraftChatScopeApply": [
    "pixel-btn",
    "btn-mini"
  ],
  "draftChatContextPreview": [],
  "draftChatLibrary": [
    "chat-disclosure"
  ],
  "btnDraftChatList": [
    "pixel-btn",
    "btn-mini"
  ],
  "draftChatSessions": [],
  "btnDraftChatMore": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatNew": [
    "pixel-btn",
    "btn-mini",
    "chat-new"
  ],
  "btnDraftChatDelete": [
    "pixel-btn",
    "btn-mini"
  ],
  "draftChatDeleteConfirm": [
    "chat-disclosure",
    "hidden"
  ],
  "btnDraftChatDeleteConfirm": [
    "pixel-btn",
    "btn-mini"
  ],
  "btnDraftChatDeleteKeep": [
    "pixel-btn",
    "btn-mini"
  ],
  "btnDraftChatEarlier": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "draftChatHistoryRange": [],
  "btnDraftChatLater": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatLatest": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "draftChatLog": [
    "chat-log"
  ],
  "draftChatReceiptHistory": [
    "chat-disclosure",
    "hidden"
  ],
  "draftChatReceiptsStatus": [],
  "draftChatReceipts": [],
  "btnDraftChatReceiptsMore": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "draftChatChanges": [
    "chat-changes",
    "hidden"
  ],
  "draftChatChangeTitle": [],
  "draftChatChangeStatus": [],
  "draftChatChangeCards": [],
  "draftChatStatus": [
    "capability-note",
    "hidden"
  ],
  "draftChatConversationComposer": [],
  "draftChatInputCount": [],
  "draftChatInput": [
    "pixel-input",
    "chat-input"
  ],
  "btnDraftChatDiscard": [
    "pixel-btn",
    "btn-mini"
  ],
  "btnDraftChatCancel": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatSend": [
    "pixel-btn",
    "btn-mini",
    "btn-focus"
  ],
  "btnDraftChatAdopt": [
    "pixel-btn",
    "hidden"
  ],
  "btnDraftChatReceiptClose": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatChangePreview": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatChangeConfirm": [
    "pixel-btn",
    "btn-mini",
    "btn-focus",
    "hidden"
  ],
  "btnDraftChatChangeRetry": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatChangeCancel": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatReceiptRefresh": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "btnDraftChatUndo": [
    "pixel-btn",
    "btn-mini",
    "hidden"
  ],
  "taskCreateMask": [
    "modal-mask",
    "hidden"
  ],
  "stuckMask": [
    "modal-mask",
    "hidden"
  ]
});

function createRetiringDom() {
  const nodes = {}, listeners = new Map();
  const document = { activeElement: null };
  for (const [id, classes] of Object.entries(INITIAL_CLASSES)) {
    const selector = `#${id}`, names = new Set(classes);
    nodes[selector] = {
      value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
      scrollTop: 0, scrollHeight: 100, dataset: {}, attributes: {}, focused: 0,
      classList: { add(name) { names.add(name); }, remove(name) { names.delete(name); },
        contains(name) { return names.has(name); },
        toggle(name, force) { const on = force === undefined ? !names.has(name) : force;
          if (on) names.add(name); else names.delete(name); return on; } },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      focus() { this.focused++; document.activeElement = this; },
      querySelector() { return null; },
      addEventListener(type, listener) { listeners.set(`${selector}:${type}`, listener); },
      removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
    };
  }
  const $ = selector => nodes[selector] || null;
  return { document, $, nodes, listeners,
    fire: (selector, type, event = {}) => listeners.get(`${selector}:${type}`)?.(event) };
}
module.exports = { createRetiringDom };
