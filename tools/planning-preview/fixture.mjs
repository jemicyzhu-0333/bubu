import { createPlanningPreferencesFeature } from '../../src/surfaces/popover/features/planning-preferences.mjs';
const data = await (await fetch('./planning-preview-data.json')).json();
const $ = selector => document.querySelector(selector);
const client = {
  getPlanningGuidance: async () => data.view,
  cancelPlanningPreview: async () => ({ ok: true, cancelled: true }),
  previewEnergyCurveTrial: async () => data.trial,
  confirmEnergyCurveTrial: async () => ({ ok: false, reason: 'synthetic-read-only' }),
  previewPlanningPreference: async () => ({ ok: false, reason: 'synthetic-read-only' }),
  previewEnergyHistoryConsent: async () => ({ ok: false, reason: 'synthetic-read-only' }),
  onPopoverHidden: () => () => {}
};
document.documentElement.dataset.appearance = 'light';
$('#settingsMask').classList.remove('hidden'); $('#settingsMask').setAttribute('aria-hidden', 'false');
$('#settingGroupPlanning').open = false;
const feature = createPlanningPreferencesFeature({ document, $, client, now: () => data.now });
feature.init(); $('#settingGroupPlanning').open = true; await feature.reload();
await new Promise(resolve => setTimeout(resolve, 30));
const mode = new URLSearchParams(location.search).get('mode');
if (mode === 'compare') { await feature.preview('trial'); $('#planningReview').scrollIntoView({ block: 'center' }); }
else $('#settingGroupPlanning').scrollIntoView({ block: 'start' });
$('#planningStatus').textContent = '合成数据界面预览；确认不会执行真实写入。';
document.documentElement.dataset.planningReady = 'true';
