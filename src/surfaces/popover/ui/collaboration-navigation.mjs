'use strict';

// Collaboration replaces the originating form visually. Its DOM and unsaved
// fields stay intact, but there is only one visible modal and one focus trap.
function createCollaborationNavigation({ document, $, restoreModalFocus }) {
  let origin = null;
  let trigger = null;
  function open(purpose) {
    trigger = document.activeElement;
    origin = $(purpose === 'stuck' ? '#stuckMask' : '#taskCreateMask');
    if (origin?.classList.contains('hidden')) origin = null;
    if (origin) {
      origin.classList.add('hidden');
      origin.setAttribute('aria-hidden', 'true');
    }
    $('#draftChatMask')?.classList.remove('hidden');
    $('#draftChatMask')?.setAttribute('aria-hidden', 'false');
    $('#draftChatInput')?.focus();
  }
  function close({ adopted = false } = {}) {
    $('#draftChatMask')?.classList.add('hidden');
    $('#draftChatMask')?.setAttribute('aria-hidden', 'true');
    if (origin && !adopted) {
      origin.classList.remove('hidden');
      origin.setAttribute('aria-hidden', 'false');
    }
    const returnTo = trigger;
    origin = null;
    trigger = null;
    if (!adopted) restoreModalFocus(returnTo);
  }
  const isOpen = () => Boolean($('#draftChatMask') && !$('#draftChatMask').classList.contains('hidden'));
  return Object.freeze({ open, close, isOpen });
}

export { createCollaborationNavigation };
