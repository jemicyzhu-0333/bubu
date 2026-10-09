'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/renderer/popover.html'), 'utf8').replace(/\r\n/g, '\n');
const js = fs.readFileSync(path.join(root, 'src/renderer/popover.mjs'), 'utf8');
const STYLES_DIR = path.join(root, 'src/surfaces/popover/styles');
// styles.css 已按 @layer 拆成 tokens / base / components / features / utilities，
// 这一份契约仍然只问“面板上有没有这条语义”，所以按 popover.html 的加载顺序拼回一份来读。
const css = /@layer [a-z]+/.test('') ? '' : [
  'tokens.css', 'base.css', 'components.css',
  ...['app-chrome', 'companion', 'companion-drawers', 'focus-timer', 'now-card', 'quick-start-landing',
    'task-list', 'task-form', 'task-when-fields', 'task-editor', 'breakdown', 'draft-chat',
    'inbox', 'routines', 'review', 'progress', 'timeline', 'settings', 'stuck'].map(name => `features/${name}.css`),
  'utilities.css'
].map(name => fs.readFileSync(path.join(STYLES_DIR, name), 'utf8')).join('\n');
const modalJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/ui/modal.mjs'), 'utf8');
const taskDraftJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/features/task-draft.mjs'), 'utf8');
const whenFieldsJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/ui/task-when-fields.mjs'), 'utf8');
const modalLayerJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/ui/modal-layer.mjs'), 'utf8');
const modalRegistryJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/ui/modal-registry.mjs'), 'utf8');
// 收件箱自己成一层：它拥有「哪些行已经在页面上」和「打开弹层的那个控件」。所以
// 关于闪念的断言要按文件问它，而不是问面板顶上还剩什么。
const inboxJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/features/inbox.mjs'), 'utf8');
// 任务清单同理：筛选、行、溢出菜单与归档那一段都归 features/task-list。
const taskListJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/features/task-list.mjs'), 'utf8');
// 常驻外壳（页签切换、头上一条、告知、主题）归 features/app-chrome，
// 设置抽屉的开合与背景失活归 features/settings-drawer。面板顶上只剩下把两层接起
// 来的那几行，所以这两组断言也按文件问。能量那一小块不在外壳里：同一条曲线 ARCHITECTURE「日常与能量」
// 还要画在当日时间轴上方一次，所以画法单独成了 features/energy-strip。
const chromeJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/ui/panel-navigation.mjs'), 'utf8');
const settingsDrawerJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/features/settings-drawer.mjs'), 'utf8');
// 「闪念快捷键现在是哪个组合」归 features/shortcut-setting：它是主进程的运行时事实,
// 不是一条设置，所以三处提到这个组合的地方都由它写,不能再有字面量。
const shortcutJs = fs.readFileSync(path.join(root, 'src/surfaces/popover/features/shortcut-setting.mjs'), 'utf8');

// 两层各有一个 reset()，所以按文件取函数体，而不是按全局唯一的名字去切。
// 参数表里的解构大括号（reset({ title = '' } = {})）不是函数体的起点：先把参数
// 表的圆括号配平，再从后面第一个 { 开始数。
function functionSource(name, source) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `找不到 function ${name}`);
  let parens = 0;
  let bodyAt = -1;
  for (let i = source.indexOf('(', start); i < source.length; i++) {
    if (source[i] === '(') parens++;
    else if (source[i] === ')' && --parens === 0) { bodyAt = source.indexOf('{', i); break; }
  }
  assert.ok(bodyAt > 0, `function ${name} 的参数表没有闭合`);
  let depth = 0;
  for (let i = bodyAt; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} 的函数体没有闭合`);
}

test('three main destinations contain independent task and routine tabs, with a separate companion entry', () => {
  const tabs = [...html.matchAll(/<button[^>]+id="(tab[^"]+)"[^>]+data-nav="([^"]+)"[^>]+data-tab="([^"]+)"[^>]+role="tab"[^>]+aria-controls="([^"]+)"[^>]*>/g)];
  assert.deepEqual(tabs.filter(tab => tab[2] === 'main').map(tab => tab[3]), ['today', 'tasks', 'progress']);
  assert.deepEqual(tabs.filter(tab => tab[2] === 'arrange').map(tab => tab[3]), ['tasks', 'routines', 'inbox', 'archive']);
  for (const [, , , , controls] of tabs) {
    for (const id of controls.split(' ')) assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(html, /id="tabCompanion"[^>]+aria-pressed="false"[^>]+aria-controls="panelCompanion"/);
  assert.doesNotMatch(html, /data-tab="settings"|role="tab"[^>]*>[^<]*设置/);
});

test('inactive panels are hidden from layout and focus while one panel owns scrolling', () => {
  const inactivePanels = [...html.matchAll(/<section id="panel(?:Tasks|Routines|Companion|Progress)"[^>]*>/g)];
  assert.equal(inactivePanels.length, 4);
  for (const [markup] of inactivePanels) {
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, /\shidden(?:\s|>)/);
  }
  assert.match(chromeJs, /panel\.hidden = !active/);
  assert.match(fs.readFileSync(path.join(STYLES_DIR, 'theme.css'), 'utf8'), /grid-template-rows: 50px 48px auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.tab-content\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto/);
});

test('settings is a modal drawer with inert background, focus trap, Escape, and focus return', () => {
  assert.match(html, /id="btnSettings"[^>]+aria-expanded="false"[^>]+aria-controls="settingsDrawer"[^>]+aria-haspopup="dialog"/);
  assert.match(html, /id="settingsDrawer"[^>]+role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="settingsTitle"/);
  assert.match(settingsDrawerJs, /openSettingsDrawer\(\)[\s\S]*?\$\('#appShell'\)\.inert = true/);
  assert.match(settingsDrawerJs, /closeSettingsDrawer\(\)[\s\S]*?\$\('#appShell'\)\.inert = false/);
  // 困焦与 Escape 不再是面板里的两条 if-else 链，而是顺序表里的一行 + 登记处的
  // 机制。断言跟着搬:抽屉要在表里声明自己的困焦容器与 close 语义，面板要把
  // 抽屉那一层的 isOpen / close 交给它,登记处要真的按这一行困焦与关闭。
  assert.match(
    modalLayerJs,
    /\{ name: 'settings', trap: '#settingsDrawer', focusRank: \d+, dismissRank: \d+, escape: 'close' \}/
  );
  assert.match(js, /settings: \{ isOpen: settingsDrawer\.isOpen, close: settingsDrawer\.close \}/);
  assert.match(modalLayerJs, /close: \(handle\) => \(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?handle\.close\(\)/);
  assert.match(modalRegistryJs, /if \(top\) modalPrimitive\.trapFocusWithin\(event, \$\(top\.trap\)\)/);
  assert.match(settingsDrawerJs, /requestAnimationFrame\(\(\) => \$\('#btnSettings'\)\.focus\(\)\)/);
});

test('settings are folded by functional module so the drawer opens as a short menu', () => {
  // 每一项设置都归属于恰好一个模块：一个平铺在分组外的开关无处可找。
  // 结束标记要从起点往后找:伙伴页那两个抽屉同样是 settings-drawer 结构,排在
  // #settingsMask 前面,绝对位置的 indexOf 会先撞上它们、把这一段切成空串。
  const scrollStart = html.indexOf('<div class="settings-drawer-scroll">');
  const drawer = html.slice(scrollStart, html.indexOf('</section>\n  </div>', scrollStart));
  const groups = [];
  const stack = [];
  // Help disclosures may nest inside a functional group. Check the ownership
  // tree, not the old assumption that every details element is a setting group.
  for (const match of drawer.matchAll(/<\/?details\b[^>]*>/g)) {
    if (match[0].startsWith('</')) {
      const entry = stack.pop();
      assert.ok(entry, 'every closing details has an opening element');
      if (stack.length === 0) groups.push({ ...entry, end: match.index + match[0].length });
    } else {
      if (stack.length === 0) {
        assert.match(match[0], /class="[^"]*\bsetting-group\b[^"]*"/);
        assert.doesNotMatch(match[0], /\sopen(?:\s|>)/, 'functional groups start collapsed');
      }
      stack.push({ id: /\bid="([^"]+)"/.exec(match[0])?.[1], start: match.index });
    }
  }
  assert.equal(stack.length, 0, 'all settings disclosures close');
  assert.deepEqual(groups.map(group => group.id), [
    'settingGroupGeneral', 'settingGroupAppearance', 'settingGroupSensory', 'settingGroupActivityMirror', 'settingGroupWorkHours', 'settingGroupNudges',
    'settingGroupAssist', 'settingGroupEnergy', 'settingGroupPlanning', 'appUpdateGroup', 'settingGroupAi'
  ]);
  for (const control of drawer.matchAll(/<(?:input|select|textarea|button)\b[^>]*>/g)) {
    assert.equal(groups.filter(group => control.index > group.start && control.index < group.end).length, 1,
      `${control[0]} belongs to exactly one functional group`);
  }
  const workHours = groups.find(group => group.id === 'settingGroupWorkHours');
  assert.match(drawer.slice(workHours.start, workHours.end), /id="settingGroupTiming"/);
  assert.match(drawer.slice(workHours.start, workHours.end), /data-setting="workStart"/);
  assert.match(drawer.slice(workHours.start, workHours.end), /data-setting="pomodoro"/);
  const assist = groups.find(group => group.id === 'settingGroupAssist');
  assert.match(drawer.slice(assist.start, assist.end), /id="settingGroupShortcuts"/);
  assert.match(drawer.slice(assist.start, assist.end), /id="quickPanelRecorder"/);
  // 标题就是 summary 本身，不再存在一个与内容无关联的裸标题。
  assert.equal((drawer.match(/class="setting-group-title"/g) || []).length, groups.length);
  assert.doesNotMatch(html, /setting-section-title/);
  assert.doesNotMatch(css, /\.setting-section-title/);
  assert.match(css, /\.setting-group > summary \{[\s\S]*?cursor: pointer/);

  // 收起的 details 内部根本不可聚焦，它们不能在焦点环里占位，否则 Tab
  // 会落到一个不存在的控件上。select / textarea 同理：漏掉它们时，activeIndex
  // 是 -1，下一次 Tab 会被送回第一个控件而不是往前走。
  assert.match(modalJs, /function insideCollapsedDetails\(element\)[\s\S]*?closest\('details:not\(\[open\]\)'\)/);
  assert.match(modalJs, /function focusable\(container\)[\s\S]*?select:not\(\[disabled\]\)[\s\S]*?textarea:not\(\[disabled\]\)/);
  assert.match(modalJs, /function focusable\(container\)[\s\S]*?!insideCollapsedDetails\(element\)/);
});

test('every place that names the quick-capture chord is written from the effective binding', () => {
  // 绑定是一道阶梯：配置的组合被别的程序占着时主进程会退级，于是「你设的」和
  // 「真正按得动的」可以不是一个组合。写死字面量的界面在退级之后就开始说谎，
  // 用户按着一个不通的键怀疑自己手指，所以这三处都必须由那一层写入。
  for (const id of ['btnQuickCapture', 'inboxEmptyHint']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} 必须存在，否则生效值没有落点`);
    assert.match(shortcutJs, new RegExp(`#${id}`), `${id} 必须由 shortcut-setting 写入`);
  }
  // 关掉或一级都没抢到时不能再写出任何组合：写一个按不动的键比不写更糟。
  assert.match(shortcutJs, /function effectiveLabel\(\)[\s\S]*?!describe\.enabled \|\| !describe\.registered\) return ''/);
  assert.match(shortcutJs, /label \? t\('快捷行动 \{shortcut\}', \{ shortcut: label \}\) : t\('打开快捷行动面板'\)/);

  // 录制键上画的是**配置值**，生效值只出现在下面那一行。退级绝不回写配置：
  // 占用的程序关掉之后，用户本来想要的组合应当自己回来。
  assert.match(shortcutJs, /recorder\.textContent = configured \|\| t\('未设置'\)/);
  assert.doesNotMatch(shortcutJs, /quickPanelShortcut:\s*describe/);
  assert.equal((shortcutJs.match(/quickPanelShortcut:/g) || []).length, 1,
    '配置值只在用户录制时被写入一次，任何退级路径都不得改写它');
  assert.match(shortcutJs, /usedFallback[\s\S]*?配置没被改掉/);

  // 每次改动之后重新问一遍主进程：新组合可能同样抢不到，甚至回滚到上一个。
  assert.match(shortcutJs, /await surfaceClient\.updateSettings\(\{ quickPanelShortcut: accelerator \}\)[\s\S]*?await refresh\(\)/);
  assert.match(shortcutJs, /describe = await surfaceClient\.describeQuickPanelShortcut\(\)/);
  // 标点不在 SHORTCUT_KEY_PATTERN 里，当场拒绝而不是发一个注定被打回的值。
  assert.match(shortcutJs, /if \(!key\) \{[\s\S]*?这个键不能用于全局快捷键/);
  assert.match(shortcutJs, /if \(!modifiers\.length\) \{[\s\S]*?至少要带一个修饰键/);
});

test('the inbox has one canonical list and one pending-count entry', () => {
  assert.equal((html.match(/id="impulseList"/g) || []).length, 1);
  assert.equal((html.match(/id="tabImpCount"/g) || []).length, 1);
  assert.doesNotMatch(inboxJs + js, /inboxImpulses|migratedImpulses|copyImpulses/);
});

function taskPanelSource() {
  const start = html.indexOf('<section id="panelTasks"');
  assert.notEqual(start, -1, 'missing the tasks panel');
  const end = html.indexOf('<section id="panelProgress"', start);
  assert.notEqual(end, -1, 'the tasks panel must close before the progress panel');
  return html.slice(start, end);
}

test('the tasks panel is a repository view with exactly one creation entry', () => {
  const panel = taskPanelSource();
  // 一级页面只承载四件事：新建入口、待处理捕捉、清单、归档。三个并列的
  // 创建按钮（❋ / 拆解 / 帮我选两个）里，只有一个是真的创建动作。
  assert.equal((panel.match(/id="btnOpenTaskCreate"/g) || []).length, 1);
  assert.match(panel, /id="btnOpenTaskCreate"[^>]*aria-haspopup="dialog"[^>]*aria-controls="taskCreateMask"/);
  for (const removed of ['btnAdd', 'btnBreakdown', 'btnPickOne']) {
    assert.doesNotMatch(html, new RegExp(`id="${removed}"`), `${removed} must not survive the redesign`);
  }
  // “帮我选两个”是执行决策，只能住在 Today；候选面板也只能归 Today。
  assert.doesNotMatch(panel, /candidatePanel/);
  assert.match(html, /<section id="panelToday"[\s\S]*?id="btnChooseCandidates"[\s\S]*?id="candidatePanel"/);
  // 捕捉时要填的字段全部住在弹层里，不在一级页面上展开。
  assert.doesNotMatch(panel, /id="taskInput"|id="taskAdvanced"|class="task-advanced"/);
  assert.match(html, /id="taskCreateMask"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="taskCreateMask"[\s\S]*?id="taskInput"[\s\S]*?id="taskAdvanced"/);
});

test('every new task starts from a blank draft instead of inheriting the previous one', () => {
  // 保存后只清标题时，“截止=明天”会静默跟到下一件事上；字段越多越危险。
  // 草稿状态分两层拥有:能量与步骤归 features/task-draft，“什么时候”那一组归
  // ui/task-when-fields。所以“清空”也要在两层各自成立,并且由前者一次带上后者
  // ——少了那一句 whenFields.reset()，日期字段就会继续跟到下一件事上。
  assert.match(taskDraftJs, /function open\(\{ title = '' \} = \{\}\) \{[\s\S]*?reset\(\{ title \}\)/);
  const draftReset = functionSource('reset', taskDraftJs);
  for (const assignment of [
    "selectedEnergy = 'auto'", 'createStepsDraft = []', 'createStepsFromSuggestion = false',
    'whenFields.reset()'
  ]) {
    assert.ok(draftReset.includes(assignment), `task draft reset must clear ${assignment}`);
  }
  assert.match(draftReset, /'#taskDescriptionInput'[\s\S]*?'#tagsInput'[\s\S]*?'#estimateInput'/);

  const whenReset = functionSource('reset', whenFieldsJs);
  for (const assignment of [
    "selectedWhen = 'none'", "selectedRepeat = 'none'", 'selectedWeekdays = []',
    "selectedRepeatStrategy = 'fixed'", 'selectedPlannedFor = null', "selectedExpiryMode = 'none'"
  ]) {
    assert.ok(whenReset.includes(assignment), `task when fields reset must clear ${assignment}`);
  }
  assert.match(whenReset, /setScheduledFor\(null\)[\s\S]*?setDeadline\(null\)/);
});

test('inbox and archive are peer arrangement tabs with their own panels', () => {
  for (const [tab, panel] of [['tabInbox','panelInbox'], ['tabArchive','panelArchive']]) {
    assert.match(html, new RegExp(`id="${tab}"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}"[^>]*role="tabpanel"[^>]*aria-labelledby="${tab}"`));
  }
  assert.doesNotMatch(html, /id="inboxMask"|id="inboxStrip"|id="archivePanel"/);
});

test('a task row keeps one action and moves the rest into a labelled overflow menu', () => {
  // 440px 宽的窗口里排六个无标签符号按钮，结果是每一个都要猜，而标题被挤没了。
  const row = taskListJs.slice(
    taskListJs.indexOf('const overflowItems = []'),
    taskListJs.indexOf('const checkbox = el.querySelector')
  );
  assert.equal((row.match(/class="icon-btn [a-z]+"/g) || []).length, 2, 'a row shows only the start button and the overflow trigger');
  assert.match(row, /class="icon-btn play"/);
  assert.match(row, /class="icon-btn more"[\s\S]*?aria-haspopup="true"[\s\S]*?aria-expanded="false"/);
  assert.match(row, /role="menu"[\s\S]*?role="menuitem" data-task-action=/);
  // 溢出项必须带中文标签，删除明确说明可恢复，避免用户找不到原有出口。
  for (const [action, label] of [
    ['enrich', '帮我拆成几步'], ['edit', '编辑任务'], ['skip', '跳过这一次'],
    ['renew', '续期'], ['duplicate', '再做一遍'], ['delete', '删除任务（可恢复）']
  ]) {
    assert.ok(row.includes(`action: '${action}', label: '${label}'`), `overflow item ${action} must carry a written label`);
  }
  assert.match(taskListJs, /action === 'delete'[\s\S]*?surfaceClient\.deleteTask\(task\.id\)/);
  assert.match(taskListJs, /function setOverflowMenuOpen\([\s\S]*?classList\.toggle\('menu-open', open\)/);
  assert.match(css, /\.task-item\.menu-open[\s\S]*?overflow:\s*visible/,
    '打开菜单的任务卡必须允许菜单越过卡片边界');
  assert.match(css, /\.task-menu\s*\{[\s\S]*?position:\s*fixed/,
    '菜单必须脱离 tab-content 的滚动裁切上下文');
  assert.match(css, /\.task-item\.menu-open,\s*\.task-item\.menu-open:hover\s*\{[\s\S]*?transform:\s*none;[\s\S]*?animation:\s*none/,
    '打开菜单后任务卡不能由 hover 或入场动画重新创建 fixed containing block');
  assert.ok(css.indexOf('.task-item.new-in {') < css.indexOf('.task-item.menu-open,'),
    'menu-open 的 animation:none 必须晚于同等优先级的 new-in，否则新建卡片仍会成为 fixed containing block');
  assert.match(taskListJs, /function setOverflowMenuOpen\([\s\S]*?preferredAbove[\s\S]*?menu\.style\.top/,
    '视口底部空间不足时菜单必须向上定位');
  assert.match(taskListJs, /function closeOverflowMenu\(/);
  // 这三条监听跟着这一层的 mount/dispose 走，所以断言它们登记在可摘的 listen 上。
  assert.match(taskListJs, /listen\(document, 'click', \(\) => closeOverflowMenu\(\)\)/);
  assert.match(taskListJs, /listen\(document, 'scroll', event => \{[\s\S]*?event\.target === openOverflowMenu\.menu[\s\S]*?closeOverflowMenu\(\);[\s\S]*?\}, true\)/,
    '底层滚动应关闭菜单，但菜单自己的滚动不能把自己关掉');
  assert.match(taskListJs, /listen\(window, 'resize', \(\) => closeOverflowMenu\(\)\)/);
});

test('the archive count describes the list it heads instead of the whole ledger', () => {
  // 之前拿 history.total（全量历史）当标题，展开后的条数跟数字对不上。
  assert.match(taskListJs, /\$\('#cntArchived'\)\.textContent = total > archived\.length[\s\S]*?\$\{archived\.length\}\/\$\{total\}[\s\S]*?String\(archived\.length\)/);
});

test('updater hidden phase actions stay hidden despite themed button display rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/surfaces/popover/styles/features/settings.css'), 'utf8');
  assert.match(source, /#appUpdateGroup \[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
