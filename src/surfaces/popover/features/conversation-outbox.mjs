// Renderer-only delivery receipts. These projections never mutate canonical
// history, grant permission, or claim a message was saved to disk.
function createConversationOutbox() {
  const conversations = new Map();
  const entries = id => conversations.get(id) || [];
  function begin(record, messageId, message, selectedProposalId) {
    const previous = entries(record.id);
    const item = { conversationId: record.id, messageId, message, selectedProposalId, state: 'sending' };
    conversations.set(record.id, [...previous.filter(entry => entry.messageId !== messageId), item]);
    return item;
  }
  function settle(item, result, state = 'failed') {
    if (!entries(item.conversationId).includes(item)) return;
    item.state = state;
    reconcile(result?.conversation);
  }
  function reconcile(record) {
    if (!record) return;
    const remaining = entries(record.id).filter(item => {
      const message = record.messages.find(message => message.id === item.messageId && message.role === 'user' && message.content === item.message);
      if (!message) return true;
      return !record.messages.some(answer => answer.role === 'assistant' && answer.turnId === message.turnId && answer.turnId);
    });
    const tail = record.messages.at(-1);
    if (tail?.role === 'user' && !remaining.some(item => item.messageId === tail.id)) {
      remaining.push({ conversationId: record.id, messageId: tail.id, message: tail.content,
        selectedProposalId: record.selectedProposalId, state: record.status === 'generating' ? 'unconfirmed' : record.status === 'canceled' ? 'canceled' : 'failed' });
    }
    if (remaining.length) conversations.set(record.id, remaining);
    else conversations.delete(record.id);
  }
  function projection(record) {
    if (!record) return record;
    const pending = entries(record.id);
    if (!pending.length) return record;
    const messages = record.messages.map(message => ({ ...message }));
    for (const item of pending) {
      let message = messages.find(message => message.id === item.messageId);
      if (!message) {
        message = { id: item.messageId, role: 'user', content: item.message };
        messages.push(message);
      }
      message.localDelivery = item.state;
      message.localUnconfirmed = !record.messages.some(canonical => canonical.id === item.messageId);
    }
    return { ...record, messages, hasUnconfirmedMessages: messages.some(message => message.localUnconfirmed) };
  }
  function interrupt(conversationId, state = 'unconfirmed') {
    for (const item of entries(conversationId)) if (['sending', 'unconfirmed'].includes(item.state)) item.state = state;
  }
  return Object.freeze({ begin, settle, reconcile, projection, interrupt,
    get: (conversationId, messageId) => entries(conversationId).find(item => item.messageId === messageId),
    forget: conversationId => conversations.delete(conversationId) });
}

export { createConversationOutbox };
