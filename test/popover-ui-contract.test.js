'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const STYLES_DIR = path.join(ROOT, 'src/surfaces/popover/styles');
// 面板的语义样式按 @layer 分为 tokens / base / components / features / utilities，
// 这一份契约仍然只问“面板上有没有这条语义”，所以按 popover.html 的加载顺序拼回一份来读。
const css = [
  'tokens.css', 'base.css', 'components.css',
  ...['app-chrome', 'companion', 'companion-drawers', 'focus-timer', 'now-card', 'quick-start-landing',
    'task-list', 'task-form', 'task-when-fields', 'task-editor', 'breakdown',
    'inbox', 'review', 'progress', 'settings', 'stuck'].map(name => `features/${name}.css`),
  'utilities.css'
].map(name => fs.readFileSync(path.join(STYLES_DIR, name), 'utf8')).join('\n');
const html = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.html'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'src/preload-popover.js'), 'utf8');

// 这一份契约管的是“面板这一面实现了哪些产品语义”，而不是“哪一行落在哪个文件”。
// popover 由可独立挂载的 feature 组成，所以受审对象是这一面按加载顺序
// 拼起来的全部源码：模块边界由 popover-surface-foundation 与架构闸门去守，
// 这里保证产品语义完整，并且 doesNotMatch 覆盖整个面而不是一个文件。
const surfaceScripts = ['popover.mjs', ...fs.readdirSync(path.join(ROOT, 'src/surfaces/popover/features')).filter(file => file.endsWith('.mjs')).map(file => '../surfaces/popover/features/' + file), ...fs.readdirSync(path.join(ROOT, 'src/surfaces/popover/ui')).filter(file => file.endsWith('.mjs')).map(file => '../surfaces/popover/ui/' + file)];
const surfaceSource = src => fs.readFileSync(path.join(RENDERER_DIR, src.replace(/\.js$/, '.mjs')), 'utf8');
const js = surfaceScripts.map(surfaceSource).join('\n');
const taskLimits = fs.readFileSync(
  path.join(ROOT, 'src/capabilities/work/contract/task-limits.mjs'), 'utf8'
);

// 新任务草稿被拆成两层:能量 / 步骤 / 提交归 features/task-draft，“什么时候”那一
// 组字段归 ui/task-when-fields。有几条断言问的正是“哪一层拥有哪些字段”，那就得
// 按文件取样,否则拼起来的整面源码会让两层的分工看起来仍旧是一坨。
const taskDraftJs = surfaceSource('../surfaces/popover/features/task-draft.mjs');
const whenFieldsJs = surfaceSource('../surfaces/popover/ui/task-when-fields.mjs');
// 统一编辑面板搬进自己的 feature 之后,草稿改叫 draft、关闭改叫 close——这些名字
// 在拼起来的整面源码里到处都是,锚不住。所以按文件取样:问的还是同一件事,
// “这一次编辑的草稿归谁、保存时折出的操作按什么顺序发”,只是问得准。
const taskEditorJs = surfaceSource('../surfaces/popover/features/task-editor.js');
// 完成确认同理:open / close / confirm 在整面源码里锚不住,而“按下勾选”和“还剩几
// 步那一问”是同一层的两半,按文件取样才能问出它们确实在一起。
const completeConfirmJs = surfaceSource('../surfaces/popover/features/complete-confirm.js');
// 「卡住了」同理:一层里的 open / close / isOpen 在整面源码里锚不住。它拥有的正是
// “卡在哪”这个答案,所以按文件取样才问得出“这个答案只有一份、就在这一层里”。
const stuckJs = surfaceSource('../surfaces/popover/features/stuck.js');
// 落点提示也同理:它拥有的两样状态(这次露面的是哪一个落点、它出现之前焦点在哪)
// 改名成了模块私有的 promptKey / returnFocus,只有按文件取样才问得出“这两个答案
// 就在这一层里,不在面板顶上”。
const landingJs = surfaceSource('../surfaces/popover/features/quick-start-landing.js');
// 每日回顾同理:它拥有的「此刻打开的是哪一张回顾卡」以前是面板顶上的 activeReview,
// 现在是这一层的私有 active;open / close / isOpen 在整面源码里锚不住。
const reviewJs = surfaceSource('../surfaces/popover/features/review.js');
// 「此刻这一件」同理:它拥有 currentTask / 候选缓存 / 候选面板的焦点归属,而
// syncBlocker、runQuickStart 这些名字只是它对外要的答案,得按文件问它。
const nowCardJs = surfaceSource('../surfaces/popover/features/now-card.js');
const focusTimerJs = surfaceSource('../surfaces/popover/features/focus-timer.js');
const sessionViewJs = surfaceSource('../surfaces/popover/state/session-view.js');
const rendererJs = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.mjs'), 'utf8');

// 取一段实现的源码时靠花括号配平，而不是靠“下一个函数正好排在它后面”。
// 拆分会不断改变一段代码的邻居和缩进，用位置锚点切片会在搬家时静默切出空串，
// 于是断言全部空过 —— 那比直接失败更糟。
function blockFrom(source, start, braceFrom, label) {
  let depth = 0;
  for (let i = source.indexOf('{', braceFrom); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${label} has unbalanced braces`);
}

function sourceBlock(anchor, source = js) {
  const start = typeof anchor === 'string' ? source.indexOf(anchor) : source.search(anchor);
  assert.ok(start >= 0, `${anchor} must remain auditable in the popover surface`);
  return blockFrom(source, start, start, anchor);
}

// 一个函数的主体从参数表之后那个花括号开始。参数表本身也可能是花括号（解构），
// 所以要先把整个参数表跳过去：否则 async function close({ saveProgress = true })
// 会被当成“主体只有一个参数”切出来，那一段里什么断言都匹配不到，而失败信息看
// 起来像是实现丢了这段代码。
function functionSource(name, source = js) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `function ${name} must remain auditable in the popover surface`);
  let depth = 0;
  let cursor = source.indexOf('(', start);
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') depth += 1;
    else if (source[cursor] === ')' && --depth === 0) break;
  }
  return blockFrom(source, start, cursor, `function ${name}`);
}

// 弹层的困焦顺序与 Escape 做法由 surface 层的一张顺序表定义,而不是控制器里
// 两条手写的 if-else 链。下面这些取样器让断言继续问同一件事——这个弹层算不算
// 共享 modal 层的一员、Tab 困在哪个容器、Escape 该做什么——而不去在意它写在哪。
function modalLayerTable() {
  const start = js.indexOf('const POPOVER_MODAL_LAYER = Object.freeze([');
  assert.ok(start >= 0, 'POPOVER_MODAL_LAYER 顺序表必须留在面板源码里可审计');
  return js.slice(start, js.indexOf(']);', start));
}

function modalLayerEntry(name) {
  const table = modalLayerTable();
  const start = table.indexOf(`{ name: '${name}'`);
  assert.ok(start >= 0, `${name} 必须登记在 POPOVER_MODAL_LAYER 顺序表里`);
  return table.slice(start, table.indexOf('}', start) + 1);
}

// 注意锚点要落在调用处:modal-layer.js 里同名的 function 声明排在前面,
// 用裸函数名取样会切到策略表那一侧去。
function modalHandles(name) {
  const block = sourceBlock(/registerPopoverModals\(\{\s*registry: modalRegistry/);
  const start = block.indexOf(`${name}: {`);
  assert.ok(start >= 0, `${name} 必须把 isOpen/close 交给 registerPopoverModals`);
  return block.slice(start, block.indexOf('}', start) + 1);
}

const feature = name => fs.readFileSync(path.join(ROOT, `src/surfaces/popover/${name.replace(/\.js$/, '.mjs')}`), 'utf8');
const todayFeatureJs = feature('features/today.js');
const workFeatureJs = feature('features/work.js');
const taskListJs = feature('features/task-list.js');
const companionFeatureJs = feature('features/companion.js');
const skinPickerJs = feature('features/skin-picker.js');
const modalFeatureJs = feature('ui/modal.js');
// 拆解弹层搬进自己的 feature 之后,open / close / showLoading 这些名字在拼起来的
// 源码里太常见,锚不住。所以按文件取样:问的还是同一件事,只是问得准。
const breakdownFeatureJs = feature('features/breakdown.js');
const layersCss = feature('styles/layers.css');

function settingGroupSource(id) {
  const start = html.search(new RegExp(`<details class="[^\"]*\\bsetting-group\\b[^\"]*" id="${id}">`));
  assert.notEqual(start, -1, `missing setting group ${id}`);
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<\/?details\b[^>]*>/g)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, start + match.index + match[0].length);
  }
  assert.fail('unterminated setting group ' + id);
}

test('popover surface declares explicit CSS layers and keeps the shared hidden utility scoped', () => {
  assert.match(html, /href="\.\.\/surfaces\/popover\/styles\/layers\.css"/);
  assert.match(layersCss, /@layer tokens, base, components, features, theme, utilities;/);
  assert.match(layersCss, /@layer utilities[\s\S]*?\.hidden \{ display: none !important; \}/);
  assert.doesNotMatch(css, /^\.hidden \{ display: none !important; \}/m);
  // 运行时往 <head> 里插一段 <style> 就绕过了整张层表:那些规则谁都压不住,
  // 也没人知道它们该属于哪一层。样式要写在样式文件里,层次由 @layer 说。
  assert.doesNotMatch(js, /document\.createElement\('style'\)/);
  assert.doesNotMatch(js, /document\.head\.appendChild/);
});

// AI 写的步骤是一整句话，而单行输入框裁掉的那半句恰好是“具体做什么”：
// 一个只能看到前半句的步骤等于没有步骤。三处步骤渲染共用这一条契约。
test('a step title field wraps instead of cutting a long AI-written step', () => {
  assert.equal((js.match(/<textarea class="bd-step-input"/g) || []).length, 2, '新建与拆解预览两处');
  assert.match(js, /<textarea class="pixel-input edit-step-title"/);
  assert.doesNotMatch(js, /<input[^>]*class="(?:bd-step-input|pixel-input edit-step-title)"/);
  // 换行符会跟着标题进任务列表与通知，而那两处只渲染一行：
  // 步骤里不产生行，粘进来的换行当空格。
  assert.match(js, /function bindStepTitleField\(field, onChange\)/);
  assert.match(js, /if \(event\.key === 'Enter'\) event\.preventDefault\(\);/);
  assert.match(js, /\.replace\(\/\[\\r\\n\]\+\/g, ' '\)/);
  // 高度跟着内容走，行顶对齐；否则多行时序号会漂到整行中间。
  assert.equal((css.match(/field-sizing: content/g) || []).length, 3);
  assert.match(css, /\.bd-step \{\s*display: flex; align-items: flex-start;/);
  assert.match(css, /\.edit-step \{ display: flex; align-items: flex-start;/);
});

test('0.1.2 strategy, AI, review, history, and recurrence controls are wired end to end', () => {
  for (const id of [
    'stuckMask', 'btnStuck', 'btnStrategyRequest', 'strategyCard',
    'reviewStrip', 'reviewCards', 'reviewMask', 'reviewDone',
    'aiModelInput', 'aiBaseUrlInput', 'aiApiKeyInput', 'aiSaveConfig',
    'aiImportCredential', 'aiClearCredential',
    'historyLoadMore', 'editSeriesSave', 'editSeriesPause', 'editSeriesResume', 'editSeriesEnd'
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);

  for (const channel of [
    'strategy:request', 'strategy:feedback', 'ai:preview-breakdown', 'tasks:apply-proposal', 'tasks:dismiss-proposal',
    'reviews:open', 'reviews:resolve', 'history:list', 'series:update'
  ]) assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`), `preload does not expose ${channel}`);

  assert.match(js, /previewAiBreakdown\([\s\S]*?proposalId/);
  assert.match(breakdownFeatureJs,
    /proposalId: breakdownContext\.proposalId[\s\S]*?applyBreakdownProposal\(submission\.proposalId/);
  assert.match(functionSource('close', breakdownFeatureJs), /dismissBreakdownProposal\(proposalId\)/);
  assert.match(reviewJs, /function renderCards\([\s\S]*?void open\(item\.id\)/);
  assert.match(js, /function loadMoreHistory\([\s\S]*?state\.history\.nextCursor/);
  assert.match(js, /#editSeriesResume'[\s\S]*?'active'/);
});

test('the energy curve has a switch that turns it off and a way to discard what it learned', () => {
  // ARCHITECTURE「日常与能量」: 「这个开关不是可选项」—— a curve that quantifies your own state makes
  // some people more anxious, and there has to be somewhere to turn it off.
  const group = settingGroupSource('settingGroupPlanning');
  assert.match(group, /data-toggle="energyCurveEnabled"/);
  assert.match(group, /id="btnResetEnergyCalibration"/);
  assert.match(group, /id="energyCalibrationStatus"/);
  // Both key lists in the drawer, or the toggle renders stale after a press.
  assert.match(js, /'aiMemoryEnabled', 'aiImpulseEnergyEnabled', 'aiCaptureTriageEnabled', 'aiPetMealsEnabled', 'energyCurveEnabled'\]\) \{\n\s*const toggle/);
  assert.match(js, /'aiMemoryEnabled', 'aiImpulseEnergyEnabled', 'aiCaptureTriageEnabled', 'aiPetMealsEnabled', 'energyCurveEnabled'\]\) \{\n\s*listen/);
  // ARCHITECTURE「事实流与长期记忆」's way back is two presses, like 全部忘掉: one press swaps the label, the
  // second one commits, and folding the group away forgets the first press.
  assert.match(js, /if \(!pendingCalibrationReset\) \{[\s\S]*?button\.textContent = t\('真的重置'\)/);
  assert.match(js, /await surfaceClient\.resetEnergyCalibration\(\)/);
  assert.match(js, /if \(group && group\.open === false\) \{ clearPendingCalibrationReset\(\)/);
  // changed=false is a distinct answer, not a silent success: "暂无校准数据" and
  // "校准已重置" are different things to have just done.
  assert.match(js, /result\.changed[\s\S]*?'校准已重置[\s\S]*?'暂无校准数据/);
});

test('the AI section exposes one master switch plus the two parameters a request needs', () => {
  const group = settingGroupSource('settingGroupAi');
  // 总开关、模型、Base URL —— 三个东西，一个不少。
  assert.match(group, /data-toggle="aiBreakdownEnabled"/);
  assert.match(group, /id="aiModelInput"[^>]*maxlength="80"/);
  assert.match(group, /id="aiBaseUrlInput"[^>]*type="url"|type="url"[^>]*id="aiBaseUrlInput"/);
  assert.match(group, /id="aiBaseUrlInput"[^>]*maxlength="200"/);
  // Provider 下拉框被删掉了：只剩一种连接形态（一个 OpenAI 兼容端点），
  // “连哪儿”完全由 Base URL 决定。一个只能选一项的下拉框不提供信息，只提供选错的机会。
  // 长期记忆拥有类别、范围与隐私三个选择器；它们都不是Provider连接类型。
  assert.deepEqual(
    [...group.matchAll(/<select[^>]*\bid="([^"]*)"/g)].map(match => match[1]),
    ['aiDiagnosticsRuns', 'memoryDraftKind', 'memoryDraftScope', 'memoryDraftPrivacy']
  );
  assert.doesNotMatch(html, /id="aiProviderSelect"/);
  assert.doesNotMatch(js, /aiProvider/);

  assert.match(group, /id="aiActiveMode"[^>]*role="status"/);
  assert.match(group, /data-toggle="aiClarifyEnabled"/);
  assert.match(group, /id="aiSaveConfig"/);
  assert.match(group, /id="aiConfigStatus"[^>]*role="status"/);
  const privacy = group.match(/<details class="ai-advanced disclosure"><summary>(.*?)<\/summary><p class="capability-note" id="aiPrivacyStatus"><\/p><\/details>/s);
  assert.ok(privacy, 'privacy remains a native, labeled disclosure containing its status');
  assert.match(privacy[1], /<svg class="disclosure-icon"[^>]*aria-hidden="true"/);
  assert.match(privacy[1], /<span data-i18n="数据与隐私">数据与隐私<\/span>/);
  assert.match(group, /id="aiPrivacyStatus"/);
  assert.doesNotMatch(js, /describeAiFields|field-disclosure-required/);
  assert.ok(!preload.includes('ai:describe-fields'));
});

test('AI credentials travel inward; explicit save has a separate receipt from disclosure', () => {
  const group = settingGroupSource('settingGroupAi');
  assert.match(group, /type="password"[^>]*id="aiApiKeyInput"/);
  assert.match(group, /id="aiApiKeyInput"[^>]*autocomplete="off"/);
  assert.match(group, /id="aiApiKeyInput"[\s\S]*?id="aiSaveConfig"/);
  assert.ok(preload.includes("saveAiCredential: secret => ipcRenderer.invoke('ai:credential-import', { secret })"));
  assert.doesNotMatch(functionSource('renderSettings'), /aiApiKeyInput/);
  const config = surfaceSource('../surfaces/popover/features/ai-configuration.mjs');
  assert.doesNotMatch(config, /aiPrivacyStatus/);
  // Failure, clearing and draft concurrency are exercised by ai-configuration.test.js.
});

test('a silent fallback is not allowed: both proposal paths say why AI did not run', () => {
  // 回退是设计内的，但只说“用了本地模板”等于把一个可修的配置错误变成“模型不好用”。
  assert.match(js, /function fallbackReasonText\(reason\)/);
  // 拆解弹层与草稿补全两条路都得拿到同一句人话。
  assert.match(js, /setProviderCopy\(\(\) => preview\.fallback[\s\S]*?fallbackReasonText\(preview\.reason\)/);
  assert.match(js, /function fallbackReasonSuffix\(result\)[\s\S]*?fallbackReasonText\(reason\)/);
  assert.match(taskDraftJs, /showStatus\([\s\S]*?fallbackReasonSuffix\(suggestion\)/);
  // 认不出的原因码原样呈上，不能吞成空字符串。
  assert.match(js, /return message \? t\(message\) : reason;/);
  // 四个最可能撞上的 HTTP 状态各自有可操作的说法。
  for (const status of ['401', '404', '429', '400']) {
    assert.ok(js.includes(`status === '${status}'`), `HTTP ${status} 没有单独的说法`);
  }

  // 写在滚动区外的提示等于没写：状态行必须与触发它的按钮同在 .create-assist 里，
  // 而不是塞在“更多设置”折叠区之后。
  const assist = html.slice(html.indexOf('<section class="create-assist"'), html.indexOf('id="taskAdvanced"'));
  assert.match(assist, /id="btnEnrichDraft"[\s\S]*?id="taskFormStatus"/);
  const advancedStart = html.indexOf('id="taskAdvanced"');
  assert.ok(html.indexOf('id="taskFormStatus"') < advancedStart, '状态行不得落在折叠区之后');
});

test('the bottom control starts the chosen round and the two-minute rescue is never a free entry', () => {
  assert.doesNotMatch(js, /kickstart\(null\)/);
  assert.doesNotMatch(js, /startPomodoro\(null\s*,/);
  // 底部那个“无任务启动 2 分钟”整体移除：一段没有落点的两分钟不会改变
  // 任何事，只会把“我已经开始了”变成一句安慰。
  assert.doesNotMatch(html, /id="btnKickstart"/);
  assert.doesNotMatch(js, /btnKickstart/);
  assert.match(focusTimerJs, /#btnStartFocus'[\s\S]*?const launch = focusLaunchContext\(\);[\s\S]*?runFocusAction\('focus', launch\.task, launch\.minutes\)/);
  assert.match(focusTimerJs, /minutes: focusRange\(\)\.chosen/);

  // 两分钟只活在「卡住了」弹窗的出路屏里，而且必须先有一个写下来的下一步。
  // 它与“换个更小的下一步”“试个小办法”并列，因为三者都是卡住时的处置。
  const routeStart = html.indexOf('id="stuckStepRoute"');
  assert.notEqual(routeStart, -1, '出路屏必须存在');
  const rescue = html.slice(routeStart, html.indexOf('id="stuckStepShrink"', routeStart));
  assert.match(rescue, /id="btnNowKickstart"[^>]*disabled/);
  assert.match(rescue, /id="rescueNote"/);
  assert.match(rescue, /id="btnRouteShrink"/);
  assert.match(rescue, /id="btnRouteTip"/);
  assert.doesNotMatch(html, /id="blockerDetails"/, '折叠区已换成弹窗，不得残留');
  assert.match(nowCardJs, /#btnNowKickstart'[\s\S]*?if \(!task \|\| !task\.nextAction\) return;[\s\S]*?runQuickStart\(task\)/);
  assert.match(rendererJs, /runQuickStart: task => focusTimer\.runFocusAction\('quick-start', task, sessionDuration\.QUICK_START_MINUTES\)/);
  assert.match(nowCardJs, /const hasLanding = Boolean\(activeTask\.nextAction\);[\s\S]*?kick\.disabled = hardBlocked \|\| !hasLanding/);
});

test('the renderer reads one duration range instead of declaring its own', () => {
  // 0.1.0 shipped three disagreeing ranges. The renderer must not be able to
  // reintroduce a fourth, so it may not name these bounds at all.
  assert.doesNotMatch(js, /MIN_FULL_FOCUS_MINUTES|MAX_FULL_FOCUS_MINUTES|normalizeFullFocusMinutes/);
  assert.doesNotMatch(js, /const QUICK_START_MINUTES/);
  assert.match(js, /const sessionDuration = BubuSessionDuration;/);
  assert.match(js, /sessionDuration\.QUICK_START_MINUTES/);
  assert.match(js, /import BubuSessionDuration from '\.\.\/capabilities\/execution\/contract\/session-duration\.mjs'/);

  const shared = require('../src/capabilities/execution').sessionDuration;
  assert.equal(shared.normalizeFocusMinutes(2, 25), 5, 'engine activation signal is clamped for full focus');
  assert.equal(shared.normalizeFocusMinutes('invalid', 12, 25), 12, 'invalid candidates fall through to task duration');
  assert.equal(shared.normalizeFocusMinutes(undefined, undefined, 30), 30, 'configured duration remains the fallback');
  assert.equal(shared.normalizeFocusMinutes(500), 120, 'the renderer respects the persisted upper bound');

  assert.match(js, /const fullFocusMinutes = sessionDuration\.normalizeFocusMinutes\([\s\S]*?surfaceClient\.startPomodoro\(task \? task\.id : null, fullFocusMinutes\)/);
  assert.match(js, /function focusRange\(\)[\s\S]*?state && state\.focusMinutes/);
  assert.match(js, /pomodoroMinutes: sessionDuration\.clampFocusMinutes\(settings\.pomodoroMinutes \+ delta\)/,
    'the settings stepper must use the shared 5–120 minute contract');
  assert.doesNotMatch(js, /Math\.min\(90, s\.pomodoroMinutes/);
});

test('the round duration is adjustable and can never be shortened below invested time', () => {
  for (const id of ['durationPicker', 'durationValue', 'durationPresets', 'durationStatus']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-duration-step="-1"[^>]*aria-label="[^"]+"/);
  assert.match(html, /data-duration-step="1"[^>]*aria-label="[^"]+"/);
  // 预设渲染自 state.focusMinutes.presets，而不是写死在模版里。
  assert.match(js, /for \(const preset of range\.presets\)/);
  assert.match(js, /button\.setAttribute\('aria-pressed', String\(preset === current\)\)/);
  // 未开始时改下一轮的默认值，进行中改本轮。
  assert.match(js, /updateSettings\(\{ lastChosenFocusMinutes: next \}\)/);
  assert.match(js, /surfaceClient\.adjustPomodoroDuration\(next\)/);
  assert.match(js, /sessionDuration\.minimumAdjustableMinutes\(session\.elapsedMs \|\| 0\)/);
  assert.match(js, /if \(live && preset < floor\) \{[\s\S]*?button\.disabled = true/);
  assert.match(js, /'duration-below-invested': '[^']*结束这段[^']*'/);

  const {
    adjustSessionDuration, startFocus, createIdleSession, elapsedMs
  } = require('../src/capabilities/execution').focusSession;
  const started = startFocus(createIdleSession(0), {
    taskId: 'task-1', minutes: 25, now: 0, sessionId: 'duration-contract'
  });
  const invested = 10 * 60 * 1000;
  const shorter = adjustSessionDuration(started.session, { plannedDurationMs: 5 * 60 * 1000 }, { now: invested });
  assert.equal(shorter.ok, false);
  assert.equal(shorter.reason, 'duration-below-invested');
  const exact = adjustSessionDuration(started.session, { plannedDurationMs: invested }, { now: invested });
  assert.equal(exact.reason, 'duration-below-invested', 'stopping now is the stop action, not a duration edit');
  const longer = adjustSessionDuration(started.session, { plannedDurationMs: 60 * 60 * 1000 }, { now: invested });
  assert.equal(longer.ok, true);
  assert.equal(elapsedMs(longer.session, invested), invested, 'extending never gives back invested minutes');
  assert.equal(longer.session.endsAt, invested + 50 * 60 * 1000);
});

test('one edit panel owns every task attribute and a recurring edit must declare its scope', () => {
  for (const id of [
    'taskEditMask', 'editTitle', 'editPlannedFor', 'editScheduledFor', 'editDeadline',
    'editExpiresAt', 'editEstimate', 'editTags', 'editSteps', 'editScopeRow',
    'taskEditCancel', 'taskEditConfirm'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="editDescription"[^>]*maxlength="1000"/);
  assert.match(html, /id="editTags"[^>]*maxlength="167"/);
  assert.match(html, /id="tagsInput"[^>]*maxlength="167"/);
  assert.match(js, /class="pixel-input edit-step-title" maxlength="200"/);
  assert.match(js, /class="bd-step-input" maxlength="200"/);
  assert.match(html, /id="breakdownError"[^>]*role="alert"/);
  // 这些数字只有一份定义,面板与主进程规范化任务都从 contract 读。写死在面板里
  // 就会分叉,而分叉的表现不是报错,是“面板说还能加,主进程把这一步吃掉了”。
  assert.match(taskLimits, /STEPS: 100,/);
  assert.match(taskLimits, /TAGS: 8,/);
  assert.match(js, /const MAX_TASK_STEPS = taskInput\.limits\.STEPS;/);
  assert.doesNotMatch(js, /const MAX_TASK_STEPS = \d/);
  assert.match(js, /function tagInputError\(raw\)[\s\S]*?tag\.length > limits\.TAG\b[\s\S]*?tags\.length > limits\.TAGS/);
  assert.doesNotMatch(js, /piece\.trim\(\)\.slice\(0, 20\)/);
  assert.match(js, /function estimateInputError\(selector\)[\s\S]*?!Number\.isInteger\(minutes\)[\s\S]*?limits\.ESTIMATE_MINUTES_MAX/);
  // 重复间隔的 1–365 也是同一份定义:两处校验读同一个区间,提示语的差别只剩
  // “当前输入不会丢”这一句该不该说。
  assert.doesNotMatch(js, /interval > 365/);
  assert.match(whenFieldsJs, /recurrenceIntervalError\(\w+\.interval, \{ keepsInput: true \}\)/);
  assert.doesNotMatch(js, /Math\.round\(Number\(input\.value\)\)/);
  assert.match(taskEditorJs, /draft\.steps\.length >= maxSteps[\s\S]*?每个任务最多/);
  assert.match(breakdownFeatureJs, /breakdownContext\.steps\.length >= maxSteps[\s\S]*?showError\(\(\) => t\('每个任务最多/);
  // 上限是注进来的,不是这一层自己抄的:面板与主进程规范化任务读同一份 contract。
  assert.match(js, /maxSteps: MAX_TASK_STEPS/);
  // 分类循环按钮没了：改属性只有一个入口，而且它是一个真正的表单。
  assert.doesNotMatch(js, /updateTaskCategory|CATEGORY_ORDER|CATEGORY_META/);
  assert.doesNotMatch(html, /cat-chip|data-category=/);
  assert.match(js, /\$\('#editScopeRow'\)\.classList\.toggle\('hidden', !task\.seriesId\)/);
  // Captured task/scope payloads and retries are exercised through the production
  // feature in task-editor-lifecycle; do not require a mutable draft at dispatch.
  assert.match(js, /scope: null,[\s\S]*?syncPressedButtons\('\.edit-scope-chip', \(\) => false\)/,
    'recurring edits must not silently preselect a scope');
  assert.match(js, /if \(task\.seriesId && !draft\.scope\) \{[\s\S]*?请选择这次修改/);
  // 只发真正变了的字段，否则 current-and-future 会用默认值重写系列模版。
  assert.match(js, /if \(Object\.keys\(patch\)\.length === 0\) \{ close\(\); return; \}/);
  assert.match(js, /if \(task\.done \|\| task\.skippedAt\) \{[\s\S]*?只作为历史保留/);
  // 步骤改动先落在本地草稿上，保存时才折成一串操作。
  assert.match(js, /operations\.push\(\{ op: 'remove', stepId: id \}\)/);
  assert.match(js, /operations\.push\(\{ op: 'reorder', stepIds: keptOrder \}\)/);

  // 折出来的操作顺序就是契约：core 逐条应用，reorder 要求一份完整名单。
  // add 一旦排在 reorder 之前，名单就少一个新 ID，整个 patch 以
  // step-order-mismatch 被拒——用户这一次的全部修改一起丢。
  const fold = functionSource('buildStepOperations', taskEditorJs);
  const opOrder = [...fold.matchAll(/op: '(add|remove|rename|reorder)'/g)].map(match => match[1]);
  assert.deepEqual(opOrder, ['remove', 'rename', 'reorder', 'add'],
    'remove 缩短名单、reorder 校验名单、add 只能追加，所以 add 必须排在最后');
  // 名单按身份取：用标题过滤会把一份完整名单悄悄变成残缺名单。
  assert.match(fold, /const keptOrder = draft\.steps\.filter\(step => step\.id\)\.map\(step => step\.id\)/);
  // 新步骤只能落在末尾，所以草稿不许把它排到已保存步骤之前。
  assert.match(taskEditorJs, /function newStepsStayAtTail\(steps\)/);
  assert.match(taskEditorJs, /if \(!newStepsStayAtTail\(next\)\) \{[\s\S]*?return;/);
  // 空标题不能当成“没改”悄悄咽下去。
  assert.match(js, /if \(!\$\('#editTitle'\)\.value\.trim\(\)\) \{[\s\S]*?标题不能为空/);
  assert.match(js, /blankStep !== -1[\s\S]*?还没有标题/);
});

test('completing a task asks once about unfinished steps and offers no undo', () => {
  for (const id of ['completeConfirmMask', 'completeConfirmTask', 'completeConfirmCancel', 'completeConfirmOk']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(js, /toggleTask|toggleStep/);
  assert.match(completeConfirmJs,
    /result\.reason === 'unfinished-steps-need-confirmation'[\s\S]*?open\(task, result\.unfinishedCount \|\| 0\)/);
  // 完成没有反向操作，所以已完成的行不再提供勾选框与步骤按钮，
  // 出口是“再做一遍”而不是“重新打开”。
  assert.match(js, /const isReadOnly = task\.done \|\| isSkipped;/);
  assert.match(js, /\$\{isReadOnly \? ' disabled' : ''\}><\/button>/);
  assert.match(js, /\$\{isReadOnly \|\| s\.done \? ' disabled' : ''\}/);
  assert.match(js, /if \(isReadOnly \|\| !step \|\| step\.done\) return;[\s\S]*?surfaceClient\.completeStep\(task\.id, stepId\)/);
  assert.match(js, /if \(!isReadOnly\) \{[\s\S]*?overflowItems\.push\(\{ action: 'edit'/);
  assert.match(js, /surfaceClient\.duplicateTask\(task\.id\)/);
  assert.doesNotMatch(js, /重新打开任务：/);
  // 跳过不是失败，只属于重复任务。
  assert.match(js, /if \(series && !isReadOnly\) \{[\s\S]*?action: 'skip'/);
  assert.match(js, /surfaceClient\.skipOccurrence\(task\.id\)/);
});

test('the task panel is one list with orthogonal filters that never rewrite a task', () => {
  assert.doesNotMatch(html, /data-group="(?:daily|midterm|adhoc)"/);
  assert.doesNotMatch(html, /id="taskList(?:Daily|Midterm|Adhoc)"/);
  assert.equal((html.match(/id="taskList"/g) || []).length, 1);
  for (const filter of ['actionable', 'today', 'recurring', 'deadline', 'waiting', 'done']) {
    assert.match(html, new RegExp(`data-filter="${filter}"`));
  }
  assert.match(js, /function taskMatchesFilter\(task, filter, now = Date\.now\(\)\)/);
  // 筛选只改视图：切筛选不能发出任何写入。
  const handler = sourceBlock("document.querySelectorAll('.filter-chip')");
  assert.doesNotMatch(handler, /surfaceClient\.(?:updateTask|updateSettings|addTask)/);
  assert.match(handler, /selectedFilter = chip\.dataset\.filter;[\s\S]*?renderList\(\)/);
  // 重复与“漏了几轮”都读系列，occurrence 只知道自己那一天。
  assert.doesNotMatch(js, /dailyMissedCount/);
  assert.match(js, /const missedRounds = series && !task\.done && !task\.skippedAt && isCurrentRound \? \(series\.missedCount \|\| 0\) : 0/);
  assert.match(js, /function describeSeriesRule\(series\)/);
  assert.match(js, /interval > 1 && intervalUnit[\s\S]*?t\('每 \{count\} \{unit\}', \{ count: interval, unit: t\(intervalUnit\) \}\)/);
});

test('new-task advanced fields expose every implemented planning input without dropping payload data', () => {
  assert.match(html, /id="taskDescriptionInput"[^>]*maxlength="1000"/);
  assert.match(html, /id="repeatIntervalInput"[^>]*min="1"[^>]*max="365"/);
  assert.match(html, /type="datetime-local" id="scheduledForInput"/);
  // 草稿只组装自己拥有的字段，再把“什么时候”那一组整体摊进去:少了那一行
  // ...whenFields.values()，日期与重复就会静默地从 payload 里消失。
  assert.match(taskDraftJs, /description,[\s\S]*?energy: selectedEnergy,[\s\S]*?\.\.\.whenFields\.values\(\)/);
  assert.match(
    whenFieldsJs,
    /plannedFor: selectedPlannedFor,[\s\S]*?scheduledFor: selectedScheduledFor,[\s\S]*?deadline: selectedDeadline,[\s\S]*?expiresAt: expiresAt\(\)/
  );
  assert.match(whenFieldsJs, /frequency: selectedRepeat,[\s\S]*?interval,/);
  assert.match(js, /scheduledFromDateTimeInput\(scheduledInput\.value\)/);
  assert.match(html, /type="datetime-local" id="editScheduledFor"/);
  assert.match(js, /currentScheduled = task\.scheduledFor \? localDateTimeInputValue\(task\.scheduledFor\)/);
  assert.match(js, /patch\.scheduledFor = scheduledFromDateTimeInput\(scheduledInput\.value\)/);
});

test('task rows expose appointment context and impulse review names the actual schedule', () => {
  assert.match(js, /task\.scheduledFor/);
  assert.match(js, /t\('预约于 \{time\}', \{ time: scheduledLabel \}\)/);
  assert.match(js, /data-inbox-action="schedule" data-i18n="下个工作时段">\$\{t\('下个工作时段'\)\}</);
  assert.match(js, /import BubuTaskDates from '\.\/task-dates\.mjs'/);
});

test('a completion suggestion lands in the draft, never in the store, and never touches the title', () => {
  assert.ok(preload.includes("ipcRenderer.invoke('ai:preview-enrich'"), 'preload does not expose ai:preview-enrich');
  assert.match(html, /id="btnEnrichDraft"/);
  // 补全只往这张草稿里填：模型不碰库，用户点保存才走 tasks:add。
  const apply = functionSource('applyEnrichSuggestion', taskDraftJs);
  assert.doesNotMatch(apply, /surfaceClient\.(?:addTask|updateTask|addWithBreakdown|applyBreakdownProposal)/);
  // 标题是用户写下的事实，不是模型的输出。
  assert.doesNotMatch(apply, /#taskInput/);
  assert.doesNotMatch(apply, /suggestion\.title/);
  // 没用到模型就不替这件事想：一个字段都不填，只说清楚并把光标放到“加一步”；用到模型才填并说出口。
  assert.match(apply, /const usedModel = suggestion\.provider === 'api' && !suggestion\.fallback;\s+if \(!usedModel\) \{[\s\S]*?AI 拆解暂不可用[\s\S]*?return;\s+\}/);
  assert.doesNotMatch(apply, /通用模板/);
  assert.match(apply, /showStatus\(\(\) => filled\.length[\s\S]*?已填入草稿/);
  assert.match(js, /title="\$\{t\(task\.energyAuto \? '按标题自动推断' : '手动设定'\)\}"/);
  // 失败关闭：报错不能把已填的内容抓走。
  assert.match(taskDraftJs, /function runEnrich\(\)[\s\S]*?catch \(_\) \{[\s\S]*?已填的内容都还在/);
  assert.match(taskDraftJs, /function runEnrich\(\)[\s\S]*?proposalId = suggestion[\s\S]*?finally \{[\s\S]*?dismissBreakdownProposal\(proposalId\)/,
    '补全建议落入草稿后必须释放只读 proposal');
});

test('a suggestion about an existing task only ever adds steps through the task edit transaction', () => {
  assert.ok(preload.includes("ipcRenderer.invoke('tasks:apply-proposal'"));
  const confirm = sourceBlock(/const onConfirm = async \(\) => \{/, breakdownFeatureJs);
  // 两条路径（只读 proposal / 确定性模板）在主进程里汇到同一个 updateTask，
  // 所以它们共用完成不可逆、步骤奖励预算和重复范围这三条规则。
  assert.match(confirm, /proposalId: breakdownContext\.proposalId[\s\S]*?applyBreakdownProposal\(submission\.proposalId[\s\S]*?targetTaskId: submission\.taskId/);
  assert.match(confirm, /surfaceClient\.updateTask\([\s\S]*?submission\.taskId,[\s\S]*?op: 'add'/);
  assert.doesNotMatch(confirm, /surfaceClient\.(?:addTask|addWithBreakdown)/);
  // 重复任务的修改范围不能默默选一个：没选就拒绝，而不是猜“仅本次”。
  assert.match(confirm, /if \(breakdownContext\.seriesId && !breakdownContext\.scope\) \{[\s\S]*?return;/);
  assert.match(html, /id="bdScopeRow"[\s\S]*?data-bd-scope="current"[\s\S]*?data-bd-scope="current-and-future"/);
  assert.match(confirm, /if \(breakdownContext\.saving\) return;/,
    '保存必须有同步提交锁，双击不能发出两次写请求');
  assert.match(confirm, /submissionGeneration !== requestGeneration/,
    '迟到的保存响应不能关闭后来打开的拆解弹窗');
  assert.match(confirm, /catch \(_\) \{[\s\S]*?result = null/,
    'IPC rejection 必须回到可重试编辑态，不能成为未处理 Promise');
});

test('Now blockers are task-scoped and shrinking persists a genuinely smaller action', () => {
  // 卡点归「卡住了」那一层:NOW 卡片每次重绘问它一次,拿回徽标该写的话,
  // 而不是自己再存一份。两份不同步的表现是“弹层里选了,卡片上还是旧的”。
  assert.match(stuckJs, /if \(selectedBlockerTaskId !== task\.id\)/);
  assert.match(stuckJs, /selectedBlocker = task\.blocker \|\| null/);
  assert.match(stuckJs, /return t\(blockerLabels\[selectedBlocker\] \|\| selectedBlocker \|\| ''\)/);
  // 卡片自己只知道「问一次,拿回该写的话」,那个「谁来回答」由组合根接上。
  assert.match(nowCardJs, /const blockerLabel = syncBlocker\(activeTask\)/);
  assert.match(js, /syncBlocker: task => stuck\.syncBlockerForTask\(task\)/);
  // AI 开着时把卡点一起交给 proposal 通道；两条路都还回一个步骤数组，
  // 所以“取第一步 + 换一个往后走”对两边都成立，proposal 的 3–7 步 schema 不用改。
  assert.match(js, /previewAiBreakdown\(\{[\s\S]*?blocker: selectedBlocker \|\| null/);
  assert.match(js, /previewAiBreakdown\(\{[\s\S]*?taskId: task\.id[\s\S]*?finally \{[\s\S]*?dismissBreakdownProposal\(proposalId\)/,
    '缩小下一步只读取建议，使用后必须释放绑定到当前任务的 proposal');
  assert.match(js, /steps = await surfaceClient\.previewBreakdown\(task\.title\) \|\| \[\]/);
  assert.match(js, /shrinkCandidateIndex = \(shrinkCandidateIndex \+ 1\) % shrinkCandidates\.length/);
  assert.match(js, /const patch = \{ nextAction \}/);
  assert.match(js, /clarifyNowTask\(task\.id, patch\)/);
});

// 一个入口、先选卡点、再分三条出路。之前“卡住了”是一个折叠区、“小策略”是一个
// 常驻区块，两者都渲染成带说明文字的卡片，所以看不出哪个会改数据。
test('one stuck entry asks for the blocker once and then names what each route changes', () => {
  assert.doesNotMatch(html, /id="strategyPanel"/, '常驻策略区已并入弹窗');
  assert.doesNotMatch(html, /data-strategy-phase=/, '卡点已经回答过一次，不得再让用户选一遍阶段');
  for (const id of ['stuckStepBlocker', 'stuckStepRoute', 'stuckStepShrink', 'stuckStepTip']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  // 卡点→阶段的映射取代了手选阶段。触发条件还含估时与能量带，所以允许
  // 回退到 pre-start 再试一次，但不得无限轮询。
  assert.match(js, /const BLOCKER_TO_PHASE = Object\.freeze\(\{/);
  assert.match(js, /const phase = BLOCKER_TO_PHASE\[selectedBlocker\] \|\| 'pre-start'/);
  assert.match(js, /if \(\(!result \|\| result\.ok === false\) && phase !== 'pre-start'\) \{[\s\S]*?requestStrategy\('pre-start'/);
  // 两条出路的区别必须写在面上：一条改任务，一条不动任务。
  const route = html.slice(html.indexOf('id="stuckStepRoute"'), html.indexOf('id="stuckStepShrink"'));
  assert.match(route, /id="btnRouteShrink"[\s\S]*?会改这件任务的下一步/);
  assert.match(route, /id="btnRouteTip"[\s\S]*?不动任务/);
  // 本地策略关掉只抽走“小办法”这一条，剩下两条不受影响。
  assert.match(js, /function renderStrategyRoute\(\)[\s\S]*?#btnRouteTip'\)\.classList\.toggle\('hidden', !enabled\)/);
});

test('the stuck modal joins the shared overlay contract instead of inventing its own', () => {
  assert.match(html, /id="stuckMask"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"[^>]*aria-labelledby="stuckTitle"[^>]*aria-describedby="stuckDescription"/);
  assert.match(stuckJs, /function isOpen\(\)[\s\S]*?\$\('#stuckMask'\)/);
  // 它要算进共享的“有弹层开着吗”,困焦容器与 Escape 做法都从同一张顺序表来。
  assert.match(modalHandles('stuck'), /isOpen: stuck\.isOpen, close: stuck\.close/);
  assert.match(modalLayerEntry('stuck'), /trap: '#stuckMask'/);
  assert.match(modalLayerEntry('stuck'), /escape: 'close'/);
  assert.doesNotMatch(modalLayerEntry('stuck'), /modal: false/, '卡住弹层是 aria-modal');
  // 今天页的弹窗不能指望 restoreModalFocus 的兼底：#btnOpenTaskCreate 在带
  // aria-hidden 的任务页里，canReceiveFocus 会判否，焦点会落到 body 上。
  assert.match(stuckJs, /function close\(\)[\s\S]*?restoreModalFocus\(canReceiveFocus\(closing\) \? closing : \$\('#btnStuck'\)\)/);
});

test('a suggestion can be read without being rated, and a status line never outlives its message', () => {
  // 之前策略卡只有「有用 / 不合适」两个出口，两者都写本地偏好，
  // 想看一眼但不评价无路可走。关闭路径必须不发反馈。
  const close = functionSource('close', stuckJs);
  assert.ok(close, '卡住弹层的 close 必须是一个可以整体读完的函数');
  assert.doesNotMatch(close, /sendStrategyFeedback/, '关闭不是一种评价');
  assert.match(close, /activeStrategy = null/);

  // #strategyStatus 曾经只在请求成功那一条路径上 add('hidden')，失败与反馈路径
  // 只 remove('hidden')，于是提示永久驻留。现在它们都走同一个会自己收回去的函数。
  assert.match(js, /function showTransientStatus\(selector, message, ms = 4000\)[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?classList\.add\('hidden'\)/);
  assert.match(js, /clearTimeout\(transientStatusTimers\.get\(selector\)\)/, '重复触发不能留下旧定时器');
  for (const selector of ['#strategyStatus', '#clarifyCapabilityNote']) {
    assert.ok(js.includes(`showTransientStatus('${selector}'`), `${selector} 必须走瞬时提示`);
    assert.doesNotMatch(
      js,
      new RegExp(`\\$\\('${selector}'\\)\\.classList\\.remove\\('hidden'\\)`),
      `${selector} 不得再有只加不减的显示路径`
    );
  }
});

// 要调整当前这件事的人正在看计时器，而不是在任务页翻列表。
test('the running task shows its own steps under the timer and ticks them through completeStep', () => {
  const pomo = html.slice(html.indexOf('<section class="pomo-panel">'), html.indexOf('id="panelTasks"'));
  assert.match(pomo, /id="nowTaskDetail"/);
  assert.match(pomo, /id="nowTaskDetailTitle"/);
  assert.match(pomo, /id="btnEditNowTask"/);
  assert.ok(pomo.indexOf('id="focusActionStatus"') < pomo.indexOf('id="nowTaskDetail"'), '子项清单在最下面');
  // 进度条上方那行“当前：XXX”与这里重复，同一屏说两遍任务名。
  assert.doesNotMatch(html, /id="pomoTaskName"/);
  assert.doesNotMatch(js, /renderSessionTaskName/);
  // 运行、暂停与未开始三种状态由同一个取数函数覆盖。
  assert.match(nowCardJs, /function sessionOrLaunchTask\(\)[\s\S]*?if \(session\.taskId\) \{[\s\S]*?item\.id === session\.taskId[\s\S]*?return currentTask\(\)/);
  assert.match(nowCardJs, /function renderDetail\([^)]*\)[\s\S]*?completeStep\(task\.id, stepId\)/);
  assert.match(nowCardJs, /if \(isReadOnly \|\| !step \|\| step\.done\) return;/);
  assert.match(js, /step-next/, '下一步需要一个可见标记');
  assert.match(todayFeatureJs, /if \(all \|\| dirty\.tasks \|\| dirty\.pomodoro \|\| dirty\.focusSession \|\| dirty\.recommendations\) \{[\s\S]*?renderers\.renderNowTaskDetail\(\);/);
});

// 一屏全是字是这一页最具体的毛病，所以删掉的冗余描述得有人看着。
test('the Now card states the one thing and the one action, and nothing it already said elsewhere', () => {
  const nowCard = html.slice(html.indexOf('<section class="now-card"'), html.indexOf('id="candidatePanel"'));
  // 轮次时长已由时长选择器和启动按钮各说一次。
  assert.doesNotMatch(js, /本轮 \$\{minutes\} 分钟/);
  assert.match(nowCardJs, /function showMeta\(message = ''\)[\s\S]*?classList\.toggle\('hidden', !message\)/);
  assert.match(nowCardJs, /showMeta\(launchBlockReason \? focusActionMessage\(launchBlockReason\) : ''\)/);
  // 启动只有一个按钮：#btnNowFocus 与 #btnStartFocus 执行的是同一个动作。
  assert.doesNotMatch(html, /id="btnNowFocus"/);
  assert.doesNotMatch(js, /btnNowFocus/);
  // 卡点从一行字变成一个徽章，没卡点时不占位。
  assert.match(nowCard, /id="nowBlockerBadge"/);
  assert.match(js, /badge\.classList\.toggle\('hidden', !blockerLabel\)/);
  // “仅作估计，可随时改”是设计者的自我辩解，不是用户需要的信息。
  assert.doesNotMatch(html, /estimate-note/);
  // 帮我选两个仍须留在候选面板之前。
  assert.match(nowCard, /id="btnChooseCandidates"/);
});

test('an explicit Now outside the two cards keeps its live score without overriding the chosen duration', () => {
  assert.match(js, /const nowCandidate = state && state\.recommendations && state\.recommendations\.nowCandidate/);
  assert.match(js, /if \(nowCandidate && \(nowCandidate\.id \|\| \(nowCandidate\.task && nowCandidate\.task\.id\)\) === task\.id\) \{[\s\S]*?return nowCandidate/);
  assert.match(js, /function focusLaunchContext\(\) \{[\s\S]*?minutes: focusRange\(\)\.chosen/);
});

test('recommendation copy describes a heuristic instead of claiming objective importance', () => {
  assert.match(js, /candidate\.strategy === 'priority'/);
  assert.match(js, /排序依据：/);
  assert.doesNotMatch(js, /candidate-score">总分/);
});

test('paused sessions render their persisted remaining time and session kind', () => {
  assert.match(sessionViewJs, /const kind = f\.status === 'paused' \? \(f\.kind \|\| f\.pausedFrom\) : f\.status/);
  assert.match(focusTimerJs, /if \(!p\.running && !p\.paused\) return/);
  assert.match(focusTimerJs, /p\.paused[\s\S]*?Number\.isFinite\(reportedRemaining\) \? reportedRemaining : fallbackRemaining/);
  assert.match(todayFeatureJs, /renderNowTaskDetail\(\)/);
});

test('the visible countdown follows a renderer monotonic anchor instead of the wall clock', () => {
  assert.match(sessionViewJs, /const projection = state\.pomodoro \|\| \{\}/);
  assert.match(focusTimerJs, /function syncPomoCountdownAnchor\(\)/);
  assert.match(focusTimerJs, /sampledAt: performance\.now\(\)/);
  assert.match(focusTimerJs, /countdownRemainingAt\(pomoCountdownAnchor, performance\.now\(\)\)/);
  assert.doesNotMatch(functionSource('renderPomoTick', focusTimerJs), /Date\.now\(\)|p\.endsAt\s*-\s*now/);

  // 这个投影函数现在住在计时那一层的工厂里面，缩进多了一级，所以取它的源码要靠
  // 配对花括号而不是「顶格的那个 }」——它本身仍然是纯函数，可以单独拿出来算。
  const helperSource = functionSource('countdownRemainingAt', focusTimerJs);
  const countdownRemainingAt = Function(`${helperSource}; return countdownRemainingAt;`)();
  const anchor = { paused: false, sampledAt: 1_000, remainingMs: 60_000 };
  assert.equal(countdownRemainingAt(anchor, 31_000), 30_000);
  assert.equal(countdownRemainingAt(anchor, 500), 60_000, 'a bad clock sample cannot add or erase progress');
  assert.equal(countdownRemainingAt({ ...anchor, paused: true }, 31_000), 60_000);
});

test('offline-due pauses expose explicit confirm and abandon actions', () => {
  assert.match(html, /id="btnStopFocusText">结束这段</);
  assert.match(html, /id="btnResumeFocusText">继续</);
  assert.match(js, /p\.awaitingOfflineConfirmation === true/);
  assert.match(js, /确认计入完成/);
  assert.match(js, /放弃本轮/);
});

test('completed, skipped and expired task rows cannot bypass the start guard', () => {
  assert.match(focusTimerJs, /const hardBlocked = \['task-completed', 'task-expired', 'occurrence-skipped'\]\.includes\(launchBlockReason\)/);
  assert.match(focusTimerJs, /btnStart\.disabled = hardBlocked/);
  assert.match(focusTimerJs, /if \(\['task-expired', 'task-completed', 'occurrence-skipped'\]\.includes\(blockReason\)\)/);
  assert.match(html, /id="focusActionStatus"[^>]*role="status"/);
  // 自动失效与任何分类无关：只看这件任务自己带的 expiresAt。
  assert.match(focusTimerJs, /const expiresAt = task\.expiresAt \? Date\.parse\(task\.expiresAt\) : Number\.NaN;/);
  assert.match(taskListJs, /surfaceClient\.renewTask\(task\.id, state && state\.autoExpiryPreview\)/);
});

test('task action messages use the canonical core refusal reasons', () => {
  assert.match(js, /'task-completed': '这件任务已经完成了/);
  assert.match(js, /'step-completed': '这一步已经勾过/);
  assert.match(js, /'occurrence-skipped': '这一次已经跳过/);
  assert.doesNotMatch(js, /'task-already-done':|'step-already-done':|'task-skipped':/);
});

test('focus launch reports both timer conflict reasons returned by the session core', () => {
  assert.match(js, /'already-running': '这段计时已经在进行或暂停中。'/);
  assert.match(js, /'session-active': '已有另一段计时正在进行或暂停中，请先处理当前计时。'/);
  assert.match(js, /showFocusActionStatus\(\(\) => focusActionMessage\(result && result\.reason\)\)/);
});

test('quick-start failures remain visible inside the still-modal landing decision', () => {
  assert.match(html, /id="quickStartError"[^>]*role="alert"/);
  assert.match(landingJs, /const result = await surfaceClient\[method\]/);
  assert.match(landingJs, /owns\(\) && \(!result \|\| result\.ok === false\)\) showError/);
});

test('one landing modal captures a real restart cue for quick-start and full focus', () => {
  assert.match(html, /for="landingNote"[^>]*>我停在 \/ 下次先做（可选）/);
  assert.match(html, /id="landingNoteField"/);
  assert.match(html, /id="landingNote"[^>]*maxlength="200"/);
  assert.match(html, /id="quickStartLandingActions"/);
  assert.match(html, /id="focusLandingActions"/);
  assert.match(html, /data-focus-landing="skip"[^>]*>暂时跳过/);
  assert.match(html, /data-focus-landing="save"[^>]*>保存落点/);

  assert.match(js, /state\.focusLandingPrompt/);
  assert.match(js, /focusPrompt\.status === 'pending'/);
  assert.match(js, /landingNoteField'\)\.classList\.toggle\('hidden', !prompt\.taskEditable\)/);
  assert.match(landingJs, /surfaceClient\[method\]\(\{[\s\S]*?sessionId: prompt\.sessionId, action,[\s\S]*?progressMade:[\s\S]*?landingNote:/);
  assert.match(landingJs, /action === 'save' && \(!prompt\.taskEditable \|\| !note\)/);
  assert.match(html, /type="checkbox" id="landingProgressMade"/);
});

test('shutdown landing uses handoff language without claiming focus completion', () => {
  assert.match(js, /healthyShutdown: focusPrompt\.healthyShutdown === true/);
  assert.match(js, /isHealthyShutdown[\s\S]*?'收工前，给下次留个入口'/);
  assert.match(js, /isHealthyShutdown[\s\S]*?'这不是一次完成结算。留一句下次能直接动手的提示，或安心跳过。'/);
});

test('landing copy reflects the real break state and never invents an active rest', () => {
  assert.match(js, /breakState: session\.mode === 'break' && session\.running[\s\S]*?'running'[\s\S]*?session\.mode === 'break' && session\.paused \? 'paused' : 'inactive'/);
  assert.match(js, /prompt\.breakState === 'running'[\s\S]*?'休息正在进行/);
  assert.match(js, /prompt\.breakState === 'paused'[\s\S]*?'休息已经暂停/);
  assert.match(js, /'这段专注的落点仍为你保留/);
  assert.doesNotMatch(js, /'休息已经开始。你可以留一句落点/);
});

test('quick-start resolution remains a keyboard-modal decision', () => {
  assert.match(modalHandles('quickStart'), /isOpen: landing\.isOpen/);
  assert.doesNotMatch(modalLayerEntry('quickStart'), /modal: false/, '落点决策是 aria-modal');
  assert.match(modalFeatureJs, /function trapFocusWithin/);
  assert.match(modalLayerEntry('quickStart'), /trap: '#quickStartMask'/);
  // 它不能被 Escape 关掉——要的就是一次表态;Escape 只把焦点送到那个“可以什么
  // 都不选”的动作上,所以这一层没有 close,走的是专门的出口策略。
  assert.match(modalLayerEntry('quickStart'), /escape: 'focusEscapeHatch'/);
  assert.doesNotMatch(modalHandles('quickStart'), /close:/);
  assert.match(
    js,
    /focusEscapeHatch: \(handle\) => \(event\) => \{[\s\S]*?data-quick-resolution[\s\S]*?target\.focus\(\)/
  );
});

test('a landing decision never stacks with or loses focus to an editor modal', () => {
  // 会占住 aria-modal 层的弹层写成一份有名字的清单,而不是每处重新或一遍谓词。
  assert.match(
    js,
    /const POPOVER_LANDING_BLOCKING_MODALS = Object\.freeze\(\[[\s\S]*?'taskEdit', 'completeConfirm', 'breakdown', 'settings', 'review', 'stuck'/
  );
  // 那份清单是注进落点这一层的,它自己不认识别的弹层叫什么名字。
  assert.match(
    landingJs,
    /const editorOwnsModal = pending[\s\S]*?landingBlockingModals\.some\(name => modalRegistry\.isOpen\(name\)\)/
  );
  assert.match(landingJs, /const visible = pending && !editorOwnsModal/);
  assert.match(landingJs, /if \(visible && \(changedPrompt \|\| !wasVisible\)\)/);
  assert.match(functionSource('close', breakdownFeatureJs),
    /if \(activeLandingPrompt\(\)\) \{[\s\S]*?renderLanding\(\);[\s\S]*?return;/);
  // 拆解弹层不认识落点决策,它只知道有人要它把这一层让出去:接线在组合根里。
  assert.match(js, /renderLanding: landing\.render/);
  assert.match(js, /isLandingModalOpen: landing\.isOpen/);
  // 所有弹层共用一份焦点归属规则，不再每个弹层各写一套。
  assert.match(js, /function restoreModalFocus\(trigger\)[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?if \(landing\.activePrompt\(\)\) \{[\s\S]*?landing\.render\(\);[\s\S]*?return;/);
  assert.match(taskEditorJs, /function close\(\)[\s\S]*?restoreModalFocus\(closing\)/);
  assert.match(completeConfirmJs, /function close\(\)[\s\S]*?restoreModalFocus\(closing\)/);
  assert.match(functionSource('hide', reviewJs),
    /if \(activeLandingPrompt\(\)\) \{[\s\S]*?renderLanding\(\)/);
  // Tab 与 Escape 都只有一个入口,落点决策在两条顺序里都排在设置抽屉之后。
  assert.match(js, /if \(event\.key === 'Tab'\) handleTab\(event\);\s*else if \(event\.key === 'Escape'\) handleEscape\(event\)/);
  assert.match(modalLayerEntry('quickStart'), /focusRank: 2, dismissRank: 2/);
});

test('a landing decision that arrives during breakdown preview wins the modal race', () => {
  const open = functionSource('open', breakdownFeatureJs);
  const loading = open.indexOf('showLoading(task, aiEnabled)');
  const preview = open.indexOf('await surfaceClient.previewBreakdown(task.title)');
  const guard = open.indexOf('activeLandingPrompt() || isLandingModalOpen()', preview);
  const close = open.indexOf('close()', guard);

  assert.ok(loading >= 0 && preview > loading,
    '拆解弹层必须在等待 IPC 前先显示明确进行态');
  assert.ok(guard > preview && close > guard,
    'IPC 等待期间出现落点决策时，必须先关闭拆解弹层再显示落点');
});

test('closing a landing decision restores focus to a still-valid control', () => {
  // “它出现之前焦点在哪”是这一层自己的记忆,不再挂在面板顶上。
  assert.match(landingJs, /let returnFocus = null/);
  assert.doesNotMatch(js, /let landingReturnFocus = null/);
  assert.match(landingJs, /function rememberReturnFocus\(/);
  assert.match(landingJs, /function restoreFocusAfterLanding\(\)[\s\S]*?requestAnimationFrame[\s\S]*?if \(modalRegistry\.isAnyOpen\(\) \|\| activePrompt\(\) \|\| !mounted\) return;[\s\S]*?target\.focus\(\)/);
  assert.match(landingJs, /if \(!pending\) \{[\s\S]*?if \(wasVisible\) restoreFocusAfterLanding\(\)/);
  assert.match(landingJs, /if \(visible && !wasVisible\) rememberReturnFocus\(\)/);
  assert.match(functionSource('close', breakdownFeatureJs),
    /rememberLandingReturnFocus\(trigger\)[\s\S]*?renderLanding\(\)/);
  assert.match(js, /function restoreModalFocus\(trigger\)[\s\S]*?if \(landing\.activePrompt\(\)\) \{[\s\S]*?landing\.rememberReturnFocus\(trigger\)[\s\S]*?landing\.render\(\)/);
});

test('settings diffs immediately refresh timer structure and the Now recommendation', () => {
  assert.match(todayFeatureJs, /dirty\.recommendations \|\| dirty\.settings\) \{[\s\S]*?renderers\.renderPomoStructure\(\)/);
  assert.match(todayFeatureJs, /dirty\.focusSession \|\| dirty\.recommendations \|\| dirty\.settings\) \{[\s\S]*?renderers\.renderNowCard\(\)/);
});

test('modal focus traps ignore controls inside hidden action groups', () => {
  // “此刻能不能把焦点交给它”只有一条规则:困焦按它筛一整个容器,弹层关闭后归还
  // 焦点按同一条规则问一个元素。所以断言问的是这条规则本身,以及困焦用的是它。
  assert.match(modalFeatureJs, /function canReceiveFocus[\s\S]*?!element\.closest\('\.hidden'\)/);
  assert.match(modalFeatureJs, /!element\.closest\('\[aria-hidden="true"\]'\)/);
  assert.match(modalFeatureJs, /function focusable[\s\S]*?filter\(element => [\s\S]*?canReceiveFocus\(element\)/);
  // Tab 不会停在 tabindex="-1" 的元素上：陷阱清单里带着它们，焦点会从弹层的另一头漏出去。
  assert.match(modalFeatureJs, /function focusable[\s\S]*?getAttribute\('tabindex'\) !== '-1'/);
});

test('the task edit panel restores its opener without focusing a hidden control', () => {
  // 打开它的那个控件归编辑器自己记:弹层关掉以后它不许留在面板顶上,否则下一次
  // 打开时焦点会还给上一件任务的按钮。
  assert.match(taskEditorJs, /let trigger = null/);
  assert.match(taskEditorJs, /trigger = document\.activeElement/);
  assert.match(js, /function restoreModalFocus\(trigger\)[\s\S]*?modalPrimitive\.canReceiveFocus\(trigger\)[\s\S]*?if \(target\) target\.focus\(\)/);
  assert.match(taskEditorJs,
    /function close\(\)[\s\S]*?const closing = trigger;[\s\S]*?trigger = null;[\s\S]*?restoreModalFocus\(closing\)/);
});

test('exclusive choice buttons expose and synchronize their pressed state', () => {
  const choiceClasses = [
    'blocker-chip', 'repeat-chip', 'repeat-strategy-chip', 'weekday-chip',
    'filter-chip', 'energy-chip', 'ttl-chip', 'edit-energy-chip', 'edit-scope-chip',
    'when-chip', 'bd-scope-chip',
    'motion-mode', 'stimulation-mode', 'pet-activity-mode', 'ttl-set-chip', 'char-chip'
  ];
  for (const className of choiceClasses) {
    const buttons = [...html.matchAll(new RegExp(`<button[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'g'))];
    assert.ok(buttons.length > 0, `${className} controls must exist`);
    for (const [markup] of buttons) {
      assert.match(markup, /aria-pressed="(?:true|false)"/, `${className} must expose its initial state`);
    }
  }

  // Five absolute self-report levels. They are an exclusive choice: the one nearest the
  // current reading is pressed, and pressing it again confirms “about right”.
  const energyActions = [...html.matchAll(/<button[^>]*class="[^"]*\benergy-checkin-btn\b[^"]*"[^>]*>/g)];
  assert.equal(energyActions.length, 5);
  assert.deepEqual(energyActions.map(([markup]) => Number((markup.match(/data-level="(\d+)"/) || [])[1])), [20, 35, 50, 65, 80]);
  assert.ok(energyActions.every(([markup]) => /aria-pressed="false"/.test(markup)));

  assert.match(js, /function syncPressedButtons\([\s\S]*?classList\.toggle\('active', pressed\)[\s\S]*?setAttribute\('aria-pressed', String\(pressed\)\)/);
  for (const selector of choiceClasses) {
    assert.match(js, new RegExp(`syncPressedButtons\\('\\.${selector}'`));
  }
  // 时长预设与标签筛选由状态驱动生成，模版里没有静态按钮可供扫描，
  // 但它们同样是互斥选择，所以必须在创建处就带上 pressed 状态。
  assert.match(js, /className = `chip duration-chip\$\{preset === current \? ' active' : ''\}`;[\s\S]*?aria-pressed', String\(preset === current\)/);
  assert.match(js, /className = `chip tag-chip\$\{selectedTagFilter === tag \? ' active' : ''\}`;[\s\S]*?aria-pressed', String\(selectedTagFilter === tag\)/);
  assert.match(js, /workEndReminder[\s\S]*?wt\.setAttribute\('aria-pressed', String\(Boolean\(s\.workEndReminder\)\)\)/);
});

test('settings steppers and toggles have unique programmatic names and labelled groups', () => {
  const stepperButtons = [...html.matchAll(/<button[^>]*data-setting="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.ok(stepperButtons.length > 0);
  const stepperNames = stepperButtons.map(markup => {
    const name = markup.match(/aria-label="([^"]+)"/);
    assert.ok(name && name[1], `setting stepper needs an accessible name: ${markup}`);
    assert.match(markup, /aria-describedby="set[^"]+"/);
    return name[1];
  });
  assert.equal(new Set(stepperNames).size, stepperNames.length, 'each +/- control must name its own setting and direction');

  const toggles = [...html.matchAll(/<button[^>]*class="[^"]*\btoggle-btn\b[^"]*"[^>]*>/g)].map(match => match[0]);
  assert.ok(toggles.length > 0);
  const toggleNames = toggles.map(markup => {
    const name = markup.match(/aria-label="([^"]+)"/);
    assert.ok(name && name[1], `settings toggle needs an accessible name: ${markup}`);
    assert.match(markup, /aria-pressed="(?:true|false)"/);
    return name[1];
  });
  assert.equal(new Set(toggleNames).size, toggleNames.length);

  const labelledControlGroups = [...html.matchAll(/<(?:div)[^>]*(?:stepper|toggle-group)[^>]*role="group"[^>]*aria-labelledby="([^"]+)"[^>]*>/g)];
  // Restored independent conversation toggle; the activity mirror adds one.
  assert.equal(labelledControlGroups.length, 24);
  for (const [, labelId] of labelledControlGroups) {
    assert.match(html, new RegExp(`<label id="${labelId}"[^>]*>`));
  }
});

test('breakdown dialog names and describes itself, traps focus, and restores its trigger', () => {
  assert.match(html, /id="breakdownMask"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"[^>]*aria-labelledby="breakdownTitle"[^>]*aria-describedby="breakdownDescription"/);
  assert.match(html, /id="breakdownDescription"/);
  const loading = functionSource('showLoading', breakdownFeatureJs);
  assert.match(loading, /role="status" aria-live="polite"/);
  assert.match(loading, /bd-loading-pixels/);
  assert.match(loading, /mask\.setAttribute\('aria-busy', 'true'\)[\s\S]*?mask\.classList\.remove\('hidden'\)[\s\S]*?mask\.setAttribute\('aria-hidden', 'false'\)[\s\S]*?#bdClose'\)\.focus\(\)/);
  assert.match(loading, /#bdAddStep'\)\.disabled = true[\s\S]*?#bdConfirm'\)\.disabled = true/);
  assert.match(functionSource('finishLoading', breakdownFeatureJs),
    /#bdAddStep'\)\.disabled = false[\s\S]*?#bdConfirm'\)\.disabled = false/);
  assert.match(css, /\.bd-loading-pixels i[\s\S]*?animation:\s*breakdown-thinking/);
  assert.match(modalLayerEntry('breakdown'), /trap: '#breakdownMask'/);
  assert.match(functionSource('close', breakdownFeatureJs),
    /setAttribute\('aria-hidden', 'true'\)[\s\S]*?restoreModalFocus\(trigger\)/);
  assert.match(js, /class="bd-step-input"[^>]*aria-label="\$\{escapeHTML\(t\('第 \{number\} 步', \{ number: i \+ 1 \}\)\)\}"/);
  assert.match(js, /class="bd-step-del"[^>]*aria-label="\$\{escapeHTML\(t\('删除第 \{number\} 步', \{ number: i \+ 1 \}\)\)\}"/);
});

function panelSource(id) {
  const start = html.indexOf(`<section id="${id}"`);
  assert.notEqual(start, -1, `missing panel ${id}`);
  const nextPanel = html.indexOf('<section id="panel', start + 1);
  const end = nextPanel < 0 ? html.length : nextPanel;
  assert.notEqual(end, -1, `unterminated panel ${id}`);
  return html.slice(start, end);
}

test('the level badge and experience bar belong beside the companion, not to the progress tab', () => {
  const companion = panelSource('panelCompanion');
  const progress = panelSource('panelProgress');
  assert.match(companion, /id="lvBadge"/);
  assert.match(companion, /id="xpProgress"[^>]*role="progressbar"/);
  assert.match(companion, /id="xpBar"/);
  assert.match(companion, /id="xpText"/);
  for (const id of ['lvBadge', 'xpProgress', 'xpBar', 'xpText']) {
    assert.doesNotMatch(progress, new RegExp(`id="${id}"`), `${id} must exist once, in the companion tab`);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must not be duplicated across panels`);
  }
  // 直接呈现累计指标与待回顾入口，不重复页签标题或折叠历史。
  assert.doesNotMatch(progress, /id="weekFacts"|history-overview/);
  assert.match(progress, /id="btnReviewInbox"/);
  assert.doesNotMatch(progress, /id="streakText"|连击/);
  assert.match(progress, /class="stat-label"[^>]*>回来的次数<\/div><div class="stat-num" id="stTotalReturns"/);
  assert.doesNotMatch(html, /<div class="progress-identity">\s*<\/div>/, 'no empty container may be left behind');
});

test('the companion tab renders bond, food affinity, and milestones from the projected state', () => {
  const companion = panelSource('panelCompanion');
  for (const id of ['bondStage', 'bondBar', 'bondMeta', 'foodShopList', 'milestoneList', 'monsterCanvas']) {
    assert.match(companion, new RegExp(`id="${id}"`), `the companion tab must own #${id}`);
  }
  // 换形态与换装现在各是一个抽屉:默认视图上只剩两个入口,浏览用的那两块标记搬到
  // 遮罩层里去了,所以它们要对整份 html 断言而不是对这一节。
  for (const id of ['btnOpenSkins', 'skinEntryMeta', 'btnOpenWardrobe', 'wardrobeEntryMeta']) {
    assert.match(companion, new RegExp(`id="${id}"`), `the companion tab must own the #${id} entry`);
  }
  assert.doesNotMatch(companion, /id="skinGrid"/, '十张皮肤卡的网格已经不在默认视图上了');
  for (const id of ['skinMask', 'skinStrip', 'skinFocus', 'wardrobeMask', 'wardrobeSlots', 'wardrobeOptions']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist in the drawer layer`);
  }
  assert.match(companion, /id="bondProgress"[^>]*role="progressbar"[^>]*aria-label="[^"]+"/);

  assert.match(companionFeatureJs, /function renderCompanion\(state = getState\(\)\)[\s\S]*?state\.companionProjection/);
  assert.ok(companionFeatureJs.includes('if (bondBar) bondBar.style.width = `${bond.percent}%`;'));
  assert.ok(companionFeatureJs.includes("$('#bondProgress')?.setAttribute('aria-valuenow', String(bond.percent));"));
  assert.match(companionFeatureJs, /bondMeta\.textContent = bond\.nextLabel[\s\S]*?bond\.toNext[\s\S]*?bond\.nextLabel/);
  assert.match(companionFeatureJs, /renderFoodCollection/);
  assert.match(companionFeatureJs, /projection\.bondRoadmap/);
  assert.ok(
    companionFeatureJs.includes('if (dirty.all || dirty.skin || dirty.pet || dirty.settings || dirty.stats || dirty.tasks) {'),
    'bond points move on task and focus commits, so those diffs must repaint the companion tab'
  );
});

test('locked skins show their real unlock progress and unlocked skins show none', () => {
  // \u8fdb\u5ea6\u6761\u642c\u5230\u4e86\u6362\u5f62\u6001\u62bd\u5c49\u7684\u805a\u7126\u5361\u4e0a:\u9ed8\u8ba4\u89c6\u56fe\u4e0d\u518d\u540c\u5c4f\u6446\u5341\u5f20\u5361,\u6240\u4ee5\u8fd9\u6761\u5951\u7ea6\u8ddf\u7740
  // \u642c\u5230 skin-picker,\u4f19\u4f34\u9875\u90a3\u4e00\u5c42\u53ea\u7559\u300cN \u79cd \u00b7 \u5df2\u89e3\u9501 M\u300d\u8fd9\u884c\u526f\u6807\u9898\u3002
  assert.ok(companionFeatureJs.includes('if (dirty.all || dirty.skin || dirty.stats || dirty.tasks) renderCompanionSkin(change.state);'));
  assert.match(companionFeatureJs, /\$\('#skinEntryMeta'\)[\s\S]*?t\('\{total\} 种 · 已解锁 \{count\}', \{ total: skins\.length, count: unlocked \}\)/);
  assert.ok(skinPickerJs.includes("skin.progress ? skin.progress.current : '-'"), 'the memo key must invalidate when progress moves');
  assert.match(skinPickerJs, /const progressText = skin\.progress \? t\('当前 \{current\}\/\{target\}', skin\.progress\) : '';/);
  assert.match(skinPickerJs, /skin\.progress \? `<div class="skin-progress-outer"[\s\S]*?skin-progress-inner" style="width:\$\{progressPercent\}%"/);
  assert.match(skinPickerJs, /const progressPercent = skin\.progress && skin\.progress\.target > 0[\s\S]*?Math\.min\(100, Math\.round\(\(skin\.progress\.current \/ skin\.progress\.target\) \* 100\)\)/);
});

test('switching form is a confirmed action, not a side effect of browsing', () => {
  // \u65e7\u7684\u5341\u5361\u7f51\u683c\u662f\u70b9\u5361\u5373 switchSkin \u2014\u2014 \u624b\u6ed1\u4e00\u4e0b\u6574\u4e2a App \u7684\u914d\u8272\u5c31\u6362\u4e86,\u800c\u4e14\u6ca1\u6709\u64a4\u9500\u3002
  // \u62bd\u5c49\u91cc\u53ea\u6709\u4e00\u5904\u5199\u52a8\u4f5c,\u5b83\u5fc5\u987b\u6302\u5728\u786e\u8ba4\u952e\u4e0a;\u70b9\u80f6\u7247\u53ea\u52a8 previewedSkinId\u3002
  assert.equal(skinPickerJs.split('surfaceClient.switchSkin(').length - 1, 1,
    'switchSkin must have exactly one call site');
  assert.match(skinPickerJs, /function onFocusClick\(event\)[\s\S]*?closest\('#btnSkinApply'\)[\s\S]*?surfaceClient\.switchSkin\(skinId\)/);
  // 只看 onStripClick 自己那一段:它后面就是 onFocusClick,懒量词会一路吃过去。
  const stripClick = skinPickerJs.slice(skinPickerJs.indexOf('function onStripClick'));
  const stripClickBody = stripClick.slice(0, stripClick.indexOf('\n  }') + 4);
  assert.match(stripClickBody, /focusSkin\(getState\(\), thumb\.dataset\.skin\)/);
  assert.doesNotMatch(stripClickBody, /switchSkin/, '点胶片只换大图,不换形态');
  // \u672a\u89e3\u9501\u4e0e\u300c\u5df2\u662f\u5f53\u524d\u300d\u90fd\u9760\u7981\u7528\u952e\u8bf4\u660e\u7406\u7531,\u800c\u4e0d\u662f\u53ea\u628a\u952e\u7070\u6389\u3002
  assert.match(skinPickerJs, /const apply = skin\.current[\s\S]*?text: applyLabel\(skin\), disabled: true/);
  assert.match(skinPickerJs, /: skin\.unlocked[\s\S]*?disabled: false[\s\S]*?text: applyLabel\(skin\), disabled: true/);
  assert.match(skinPickerJs, /if \(!button \|\| button\.disabled\) return;/);
});

test('the Now card never borrows another task next step when its own task drops out of the pool', () => {
  // 已完成的任务不在推荐池里，回退到 candidates[0] 会把别的任务的步骤
  // 显示到当前任务标题下面（截图里「韩国KYC上线」配上了 OCR 任务的第一步）
  assert.doesNotMatch(
    js,
    /const candidate = recommendationForTask\(activeTask\) \|\| fallback/,
    'the Now card must not fall back to the first candidate for its next step'
  );
  assert.match(js, /actionPresentation\(getState\(\), session, activeTask, ownCandidate, \{ hasOpenTasks \}\)/);
  assert.doesNotMatch(js, /const fallback = candidates\[0\];/, 'the borrowed candidate must be gone, not merely unused');
});

test('a paused session tells the truth when its task is already complete', () => {
  // 截图里同一屏出现了「← 正在专注」「专注中，别分心」和「这件任务已经完成」
  assert.match(js, /focusState === 'running' \? '← 正在专注' : '← 计时已暂停'/,
    'only a running session may claim 正在专注');
  assert.match(js, /const focusLabel = \(\) => t\(focusState === 'running' \? '← 正在专注' : '← 计时已暂停'\)/,
    'a paused session needs its own badge');
  // The application projection is the authorization source; behavior and actual
  // button payloads are covered in focus-timer-feature/session-resume tests.
  assert.match(js, /p\.resumeAction/);
  assert.match(js, /action\?\.intent, action\?\.enabled, action\?\.reason/);
  assert.doesNotMatch(js, /重新打开任务后才能继续计时/);
  assert.match(js, /next\.textContent = activeTask\.done \|\| !writtenAction \? t\(presentation\.action\) : presentation\.action/); // Completed-task behavior is exercised in action-workspace.test.js.
});

test('the task list re-renders when the session starts or pauses so its badge stays current', () => {
  // 只在 dirty.tasks 时重渲染，会让「← 正在专注」等到下一次不相关的任务变更才出现
  assert.match(
    workFeatureJs,
    /if \(all \|\| dirty\.tasks \|\| dirty\.pomodoro \|\| dirty\.focusSession\) renderers\.renderTaskList\(\);/,
    'session transitions must refresh the rows that display the focus badge'
  );
  assert.match(js, /\$\{currentFocusId===task\.id\?\(session\.running\?'r':'p'\):'-'\}/,
    'the row signature must distinguish running from paused, or the memo will keep a stale badge');
});

test('the settings footer shows the real package version and no tagline', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const footer = html.match(/<div class="version"[^>]*>([^<]*)<\/div>/);
  assert.ok(footer, 'settings footer exists');
  assert.equal(footer[1], `小步 v${version}`);
});

// PRODUCT「界面语言」：角色是像素，工具是原生。theme.css 是 features 之后的一层，去掉那一个
// <link> 就回到旧样子；按钮与标题里不再用 emoji 当图标。
test('the first-pass interface is one removable theme layer with no emoji icons', () => {
  const theme = fs.readFileSync(path.join(STYLES_DIR, 'theme.css'), 'utf8');
  assert.match(html, /href="\.\.\/surfaces\/popover\/styles\/theme\.css"/);
  assert.ok(html.indexOf('styles/utilities.css') < html.indexOf('styles/theme.css'));
  assert.match(theme, /^@layer theme \{/m);
  assert.match(theme, /\.scanlines, \.crt-overlay \{ display: none; \}/);
  assert.match(theme, /font-variant-numeric: tabular-nums/);
  assert.match(theme, /body:not\(\[data-session="idle"\]\) #panelToday/);
  const visible = html.replace(/<!--[\s\S]*?-->/g, '');
  const emoji = visible.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B50}]/gu) || [];
  assert.deepEqual(emoji, [], 'popover.html labels carry no emoji');
  for (const phrase of ['别分心', '卡住了</button>', '帮我选两个', '可解释候选', '连击', 'Made with']) {
    assert.ok(!visible.includes(phrase), phrase);
  }
  assert.match(js, /body\.dataset\.session !== next/, 'the timer publishes the session state for layout');
});
