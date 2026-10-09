'use strict';

// Closed details expose only their first summary; outer closed details still hide it.
function createPopoverModalPrimitive({ $, $$ } = {}) {
  if (typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover modal primitive requires DOM query functions');
  }

  function insideCollapsedDetails(element) {
    let collapsed = element?.closest('details:not([open])');
    while (collapsed) {
      const summary = collapsed.querySelector(':scope > summary');
      if (!summary?.contains(element)) return true;
      collapsed = collapsed.parentElement?.closest('details:not([open])');
    }
    return false;
  }

  // Focus traps and focus restoration share the same visibility check.
  function canReceiveFocus(element) {
    return Boolean(
      element
      && element.isConnected
      && !element.disabled
      && !element.closest('.hidden')
      && !element.closest('[aria-hidden="true"]')
    );
  }

  // Programmatic-only targets are not tab stops and must not extend the trap.
  function focusable(container) {
    return [...container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), details > summary:first-of-type, [tabindex]:not([tabindex="-1"])'
    )].filter(element => element.getAttribute('tabindex') !== '-1'
      && canReceiveFocus(element) && !insideCollapsedDetails(element));
  }

  function trapFocusWithin(event, container) {
    if (event.key !== 'Tab' || !container) return;
    const items = focusable(container);
    if (!items.length) return;
    const activeIndex = items.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (activeIndex <= 0 ? items.length - 1 : activeIndex - 1)
      : (activeIndex === items.length - 1 ? 0 : activeIndex + 1);
    if (activeIndex === -1 || nextIndex !== activeIndex + (event.shiftKey ? -1 : 1)) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  }

  return Object.freeze({ insideCollapsedDetails, canReceiveFocus, trapFocusWithin, focusable });
}


export { createPopoverModalPrimitive };
