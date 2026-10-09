'use strict';
const {
  deterministicBreakdownProposal,
  deterministicEnrichProposal,
  deterministicUnstickProposal
} = require('../domain/local-proposal');

function createProposalPreview({
  getSettings, readTasks, credentialStore, providers, proposalStore, requestScope,
  presentExpression: present, cancelExpression: cancel, scheduleWaiting, now,
  requestTtlMs: PET_PRESENTATION_MAX_TTL_MS, timeoutMs: aiTimeoutMs,
  trace: llmTrace, negotiation: llmProtocolMemory
}) {
  const {
    createApiClient, createDeterministicClient, chatCompletionsEndpoint,
    describeFields, CLARIFY_MEMORY_FIELDS: clarifyMemoryFields = [],
    DEFAULT_AI_BASE_URL, runWithFallback
  } = providers;
  function presentExpression(...args) {
    try { return present(...args); } catch (_) { return null; }
  }
  function cancelExpression(...args) {
    try { return cancel(...args); } catch (_) { return false; }
  }
  function observeTrace(method, value) {
    try {
      const result = llmTrace[method](value);
      if (result && typeof result.then === 'function') Promise.resolve(result).then(() => {}, () => {});
    } catch (_) { /* Trace failure cannot retry or reject accepted owner work. */ }
  }
  // Tag choices come from canonical tasks, never renderer-supplied vocabulary.
  function existingTaskTags(state = { tasks: readTasks() }) {
    const tags = new Set();
    for (const task of Array.isArray(state.tasks) ? state.tasks : []) {
      for (const tag of task.tags || []) tags.add(tag);
    }
    return [...tags];
  }

  // ARCHITECTURE「AI 与 LLM」: unavailable or incomplete AI uses local rules.
  function selectedLlmClient(settings = getSettings()) {
    const fallback = createDeterministicClient({
      breakdown: deterministicBreakdownProposal,
      enrich: deterministicEnrichProposal,
      unstick: deterministicUnstickProposal
    });
    if (!settings.aiBreakdownEnabled) return { client: fallback, fallback };
    if (!credentialStore.status().configured) return { client: null, fallback, reason: 'provider-credential-missing' };
    // Invalid configuration must remain readable through the state projection.
    try {
      return {
        client: createApiClient({
          baseUrl: settings.aiBaseUrl || DEFAULT_AI_BASE_URL,
          model: settings.aiModel,
          timeoutMs: aiTimeoutMs,
          trace: llmTrace,
          negotiation: llmProtocolMemory,
          getCredential: () => credentialStore.get()
        }),
        fallback
      };
    } catch (error) {
      return { client: null, fallback, reason: error.message };
    }
  }

  // Disclose the negotiated endpoint using the same client rules, without I/O.
  function aiRequestEndpoint(settings) {
    const baseUrl = settings.aiBaseUrl || DEFAULT_AI_BASE_URL;
    try {
      const client = createApiClient({
        baseUrl, model: settings.aiModel, timeoutMs: aiTimeoutMs, trace: llmTrace,
        negotiation: llmProtocolMemory, getCredential: () => null
      });
      if (client && typeof client.endpoint === 'string') return client.endpoint;
    } catch {
      // 模型名还没填之类：退回默认协议的地址。
    }
    return chatCompletionsEndpoint(baseUrl);
  }

  // Keep the standing disclosure complete for every enabled request kind.
  function aiDisclosure(settings = getSettings()) {
    const selected = selectedLlmClient(settings);
    return {
      fields: [...new Set([
        ...describeFields('breakdown'), ...describeFields('enrich'),
        ...describeFields('unstick'), ...describeFields('clarify'),
        ...(settings.aiImpulseEnergyEnabled === true ? describeFields('impulse-energy') : []),
        ...(settings.aiCaptureTriageEnabled === true ? describeFields('capture-triage') : []),
        ...(settings.aiPetMealsEnabled === true ? describeFields('pet-meal') : []),
        ...(settings.aiMemoryEnabled === true ? clarifyMemoryFields : [])
      ])],
      endpoint: aiRequestEndpoint(settings),
      network: settings.aiBreakdownEnabled === true,
      activeProvider: selected.client ? selected.client.id : 'deterministic',
      blockedReason: selected.reason || null
    };
  }

  function traceProviderSelection(task, selected, settings) {
    try {
      if (!llmTrace.enabled) return;
      observeTrace('selection', {
        task,
        aiEnabled: settings.aiBreakdownEnabled === true,
        provider: selected.client ? selected.client.id : 'none',
        model: settings.aiModel || '(unset)',
        baseUrl: settings.aiBaseUrl || `${DEFAULT_AI_BASE_URL} (default)`,
        endpoint: aiRequestEndpoint(settings),
        credential: credentialStore.status().configured ? 'configured' : 'missing'
      });
      if (!selected.client) observeTrace('skipped', { task, reason: selected.reason });
    } catch (_) { /* Metadata collection is observational; selection already succeeded. */ }
  }

  function targetRefusal(taskId) {
    if (!taskId) return null;
    const task = readTasks().find(item => item.id === taskId);
    if (!task) return { ok: false, reason: 'task-not-found' };
    if (task.done) return { ok: false, reason: 'task-completed' };
    if (task.skippedAt) return { ok: false, reason: 'occurrence-skipped' };
    return null;
  }

  function withCleanup(result, generated) {
    return generated.cleanup ? { ...result, cleanup: generated.cleanup } : result;
  }

  // Only freshness refusals are normalized here; store/workflow errors keep
  // their own semantics, and deterministic requests keep their existing shape.
  function freshnessRefusal(assertCurrent, generated) {
    try { assertCurrent(); return null; }
    catch (error) {
      if (!generated.cleanup) throw error;
      return withCleanup({ ok: false, reason: 'provider-request-aborted' }, generated);
    }
  }

  async function generateProposal(task, payload, context) {
    const refusal = targetRefusal(context.taskId);
    if (refusal) return { refusal };
    const targetBefore = context.taskId ? JSON.stringify(readTasks().find(item => item.id === context.taskId)) : null;
    const settings = getSettings();
    const selected = selectedLlmClient(settings);
    traceProviderSelection(task, selected, settings);
    const requestExpression = selected.client && selected.client.id !== 'deterministic'
      ? 'system.processing'
      : 'system.thinking';
    // Keep the expression alive until this request finishes or is canceled.
    const requestEventId = presentExpression(requestExpression, {
      source: 'interaction',
      ttlMs: PET_PRESENTATION_MAX_TTL_MS,
      minHoldMs: 300
    });
    try {
      const generated = selected.client
        ? (selected.client.id === 'deterministic'
            ? { proposal: await selected.client.run(task, payload), provider: 'deterministic', fallback: false, reason: null }
            : await runWithFallback(selected.client, selected.fallback, task, payload, {
              trace: llmTrace, signal: context.signal, assertCurrent: context.assertCurrent
            }))
        : {
            proposal: await selected.fallback.run(task, payload),
            provider: 'deterministic', fallback: true, reason: selected.reason
          };
      if (generated.ok === false) return { refusal: generated };
      const stale = freshnessRefusal(context.assertCurrent, generated);
      if (stale) return { refusal: stale };
      const refusal = targetRefusal(context.taskId);
      if (refusal) return { refusal: withCleanup(refusal, generated) };
      if (context.taskId && targetBefore !== JSON.stringify(readTasks().find(item => item.id === context.taskId))) {
        return { refusal: withCleanup({ ok: false, reason: 'proposal-target-changed' }, generated) };
      }
      return { generated };
    } finally {
      cancelExpression(requestEventId, 'request-ended');
    }
  }

  // Only actionable breakdown/enrich proposals occupy confirmation slots.
  async function runLlmTask(task, payload, context) {
    const result = await generateProposal(task, payload, context);
    if (result.refusal) return result;
    const stale = freshnessRefusal(context.assertCurrent, result.generated);
    if (stale) return { refusal: stale };
    return { generated: result.generated, stored: proposalStore.put(result.generated.proposal, context) };
  }

  const inFlight = new Set();
  async function withRequest(perform) {
    const controller = new AbortController();
    const settings = getSettings();
    const remote = settings.aiBreakdownEnabled === true && credentialStore.status().configured === true;
    const checkCurrent = () => {
      const current = getSettings();
      return !controller.signal.aborted && (!remote || (current.aiBreakdownEnabled === true
        && current.aiModel === settings.aiModel && current.aiBaseUrl === settings.aiBaseUrl
        && credentialStore.status().configured === true));
    };
    let lease;
    inFlight.add(controller);
    try {
      if (remote) lease = requestScope?.begin({ checkCurrent });
      const signal = lease ? AbortSignal.any([controller.signal, lease.signal]) : controller.signal;
      const assertCurrent = () => {
        lease?.assertCurrent();
        if (!checkCurrent()) throw new Error('provider-request-aborted');
      };
      assertCurrent();
      const result = await perform({ signal, assertCurrent });
      if (result.ok === false && result.cleanup) return result;
      const stale = freshnessRefusal(assertCurrent, result);
      if (stale) return stale;
      return result;
    } finally { lease?.release(); inFlight.delete(controller); }
  }
  function cancelPending() {
    const cancelled = inFlight.size;
    for (const controller of inFlight) controller.abort();
    inFlight.clear();
    return { ok: true, cancelled };
  }

  async function previewBreakdownProposal(payload) {
    return withRequest(async request => {
      const result = await runLlmTask('breakdown', payload, {
        kind: 'breakdown',
        title: payload.title,
        description: payload.description,
        taskId: payload.taskId || null,
        signal: request.signal, assertCurrent: request.assertCurrent
      });
      if (result.refusal) return result.refusal;
      const { generated, stored } = result;
      observeTrace('result', {
        kind: 'breakdown',
        provider: generated.provider,
        fallback: generated.fallback,
        reason: generated.reason,
        steps: stored.proposal.steps.length
      });
      const showWaiting = () => {
        // 接受或过期后的 proposal 已不在 store；迟到的计时器不得伪造“等待确认”。
        if (!proposalStore.get(stored.id)) return;
        presentExpression('work.waiting', {
          eventId: `proposal.${stored.id}.waiting`,
          source: 'essential',
          ttlMs: Math.max(1, stored.expiresAt - now()),
          minHoldMs: 800
        });
      };
      if (generated.fallback) {
        presentExpression('system.unavailable', {
          eventId: `proposal.${stored.id}.provider-unavailable`,
          source: 'essential',
          ttlMs: 2200,
          minHoldMs: 1000
        });
        const waitingTimer = scheduleWaiting(stored.id, showWaiting, 2200);
        if (waitingTimer && typeof waitingTimer.unref === 'function') waitingTimer.unref();
      } else {
        showWaiting();
      }
      return withCleanup({
        ok: true,
        proposalId: stored.id,
        provider: generated.provider,
        fallback: generated.fallback,
        reason: generated.reason || null,
        steps: stored.proposal.steps,
        clarifyingQuestion: stored.proposal.clarifyingQuestion,
        expiresAt: stored.expiresAt
      }, generated);
    });
  }

  async function previewEnrichProposal(payload) {
    return withRequest(async request => {
      const allowedTags = existingTaskTags();
      const result = await runLlmTask('enrich', { ...payload, existingTags: allowedTags }, {
        kind: 'enrich',
        title: payload.title,
        description: payload.description,
        taskId: payload.taskId || null,
        allowedTags,
        signal: request.signal, assertCurrent: request.assertCurrent
      });
      if (result.refusal) return result.refusal;
      const { generated, stored } = result;
      observeTrace('result', {
        kind: 'enrich',
        provider: generated.provider,
        fallback: generated.fallback,
        reason: generated.reason,
        steps: stored.proposal.steps.length,
        energy: stored.proposal.energy,
        estimateMinutes: stored.proposal.estimateMinutes,
        tags: stored.proposal.tags
      });
      return withCleanup({
        ok: true,
        proposalId: stored.id,
        provider: generated.provider,
        fallback: generated.fallback,
        reason: generated.reason || null,
        steps: stored.proposal.steps,
        completionCriteria: stored.proposal.completionCriteria,
        energy: stored.proposal.energy,
        estimateMinutes: stored.proposal.estimateMinutes,
        tags: stored.proposal.tags,
        expiresAt: stored.expiresAt
      }, generated);
    });
  }

  // Read task content from canonical state; only the stuck note comes from IPC.
  async function suggestUnstick(payload = {}) {
    return withRequest(async request => {
      const taskId = payload.taskId || null;
      const task = taskId ? readTasks().find(item => item.id === taskId) : null;
      const result = await generateProposal('unstick', {
        title: task ? task.title : null,
        steps: task && Array.isArray(task.steps) ? task.steps : [],
        note: payload.note || null,
        taskEnergyDemand: task ? task.energy || null : null
      }, { kind: 'unstick', taskId, ...request });
      if (result.refusal) return result.refusal;
      const { generated } = result;
      observeTrace('result', {
        kind: 'unstick',
        provider: generated.provider,
        fallback: generated.fallback,
        reason: generated.reason,
        splitSteps: generated.proposal.splitSteps.length
      });
      return withCleanup({
        ok: true,
        provider: generated.provider,
        fallback: generated.fallback,
        reason: generated.reason || null,
        nextAction: generated.proposal.nextAction,
        why: generated.proposal.why,
        fallbackAction: generated.proposal.fallbackAction,
        splitSteps: generated.proposal.splitSteps
      }, generated);
    });
  }

  return Object.freeze({
    previewBreakdownProposal, previewEnrichProposal, cancelPending, suggestUnstick, aiDisclosure, targetRefusal
  });
}
module.exports = { createProposalPreview };
