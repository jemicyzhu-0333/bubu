'use strict';

const { mergeSourceRefs } = require('./conversation-record');

// Deterministic excerpts are derived, attributed data, never a replacement for
// canonical messages or a source of permission (ARCHITECTURE「AI 与 LLM」).
function deriveConversationSummary({ messages, selectedProposalId, id, segment }) {
  const sources = mergeSourceRefs(messages.map(message => message.sourceRefs));
  const selected = messages.find(message => message.proposal?.id === selectedProposalId);
  const latest = messages.at(-1);
  const excerpt = message => [...message.content].slice(0, 500).join('');
  return {
    id, segment, throughMessageId: latest.id,
    coveredMessageIds: messages.map(message => message.id),
    decisions: selected ? [{ messageId: selected.id, text: [...`Selected draft for review (${selected.proposal.id}), unapplied: ${excerpt(selected)}`].slice(0, 500).join('') }] : [],
    unresolvedQuestions: latest.role === 'assistant' && /[?？]/.test(latest.content)
      ? [{ messageId: latest.id, text: excerpt(latest) }] : [],
    sourceRefs: sources.slice(0, 50),
    text: [...messages.slice(-6).map(message => `${message.role} [${message.id}]: ${excerpt(message)}`).join('\n')].slice(0, 4000).join(''),
    contextAllowed: sources.length <= 50 && messages.every(message => message.contextAllowed)
  };
}

module.exports = { deriveConversationSummary };
