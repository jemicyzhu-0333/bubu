const test = require('node:test');
const ROOT = require('node:path').join(__dirname, '..');
const assert=require('node:assert/strict');
const {setLocale}=require(ROOT+'/src/surfaces/shared/interface/i18n.mjs');
const {createPopoverProjectionStore}=require(ROOT+'/src/surfaces/popover/state/projection-store.mjs');
const {createPopoverTaskList}=require(ROOT+'/src/surfaces/popover/features/task-list.mjs');
const {createPopoverWorkFeature}=require(ROOT+'/src/surfaces/popover/features/work.mjs');
const {createPopoverFocusTimer}=require(ROOT+'/src/surfaces/popover/features/focus-timer.mjs');
const sessionDuration=require(ROOT+'/src/capabilities/execution/contract/session-duration.mjs');
function controlDom() {
  const document = { activeElement: null }, nodes = new Map();
  const matches = (node, selector) => selector.startsWith('.')
    ? selector.slice(1).split('.').every(name => node.classList.contains(name))
    : selector.startsWith('[') ? Object.hasOwn(node.attributes, selector.slice(1, -1).split('=')[0]) : node.tagName === selector.toUpperCase();
  function element(tagName = 'DIV') {
    let markup = '', names = new Set(); const listeners = new Map();
    const node = { tagName, children: [], parentNode: null, dataset: {}, attributes: {}, style: {}, textContent: '', value: '', isConnected: true,
      get className() { return [...names].join(' '); }, set className(value) { names = new Set(value.split(/\s+/)); },
      classList: { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name),
        toggle(name, force) { const on = force ?? !names.has(name); if (on) names.add(name); else names.delete(name); } },
      get innerHTML() { return markup; }, set innerHTML(value) {
        markup = value; node.children = [];
        for (const hit of value.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<]*)/gi)) {
          const child = element(hit[1].toUpperCase()); child.textContent = hit[3];
          for (const attr of hit[2].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attr[1], attr[2]);
          child.parentNode = node; node.children.push(child);
        }
      },
      setAttribute(name, value) { node.attributes[name] = String(value); if (name === 'class') node.className = value;
        if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value; },
      getAttribute: name => node.attributes[name],
      querySelectorAll(selector) { return node.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
      closest(selector) { return matches(node, selector) ? node : node.parentNode?.closest(selector) || null; },
      appendChild(child) { child.remove(); child.parentNode = node; node.children.push(child); return child; },
      insertBefore(child, reference) { child.remove(); child.parentNode = node; node.children.splice(node.children.indexOf(reference), 0, child); },
      remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node); node.parentNode = null; },
      get firstChild() { return node.children[0] || null; }, get nextSibling() { return node.parentNode?.children[node.parentNode.children.indexOf(node) + 1] || null; },
      addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
      removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
      async emit(type, event = {}) { for (const handler of listeners.get(type) || []) await handler({ target: node, stopPropagation() {}, ...event }); },
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }; },
      focus() { document.activeElement = node; }
    }; return node;
  }
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  Object.assign(document, { createElement: tag => element(tag.toUpperCase()), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} });
  const window = { innerWidth: 440, innerHeight: 600, addEventListener() {}, removeEventListener() {}, confirm: () => true };
  return { $, document, window, element };
}

test('production locale subscription order preserves timer anchors, task controls, overflow and focus', async () => {
 setLocale('zh-CN');
 const h=controlDom();
 const task={id:'one',title:'user title',createdAt:1,energy:'medium',steps:[{id:'s',title:'step',done:false}]};
 const state={tasks:[task], archivedTasks:[{id:'old',title:'archived',done:true}], settings:{pomodoroMinutes:25,breakMinutes:5}, revision:1};
 const session={sessionId:'sess',mode:'focus',status:'running',running:true,paused:false,startedAt:1,elapsedBeforeStartMs:0,elapsedMs:0,remainingMs:1500000,plannedDurationMs:1500000,taskId:'one'};
 const store=createPopoverProjectionStore({client:{getState:async()=>state,onStateDiff:()=>()=>{}},stateChannel:{applyStateDelta(){throw Error('unused');}}});
 const feature=createPopoverTaskList({...h,getState:()=>state,getSession:()=>session,escapeHTML:String,formatMs:()=>'',localDateInputValue:()=> '2026-10-09',syncPressedButtons(){},taskDates:{},describeSeriesRule:()=>'',taskActionMessage:()=>'',formatExpiry:()=>'',surfaceClient:{},taskLaunchBlockReason:()=>null,seriesForTask:()=>null,completeTask(){},openTaskEditor(){},openBreakdown(){},startFocus(){},celebrate(){},showPanelStatus(){},mergeHistoryPage(){}});
 feature.mount();
 let clock=0; const old=globalThis.performance; globalThis.performance={now:()=>clock};
 const timer=createPopoverFocusTimer({document:h.document,$:h.$,$$:()=>[],getState:()=>state,getSession:()=>session,pad2:x=>String(x).padStart(2,'0'),setStatusLine(){},sessionDuration,surfaceClient:{},focusActionMessage:()=>'',currentTask:()=>task});
 const source=require('node:fs').readFileSync(ROOT+'/src/renderer/popover.mjs','utf8');
 const callback=source.match(/projectionStore\.subscribe\(change => \{([\s\S]*?)\n  \}\);/)[1];
 const mainSubscriber=new Function('initialState','focusTimer','completionFeedback','companionArt','let state=initialState; return change=> {'+callback+'}')(state,timer,{celebrateLevelUp(){}},{refreshMood(){}});
 store.subscribe(mainSubscriber);
 store.subscribe(()=>timer.renderPomoTick());
 const work=createPopoverWorkFeature({renderers:{renderTaskList:feature.renderList,renderArchivedTasks:feature.renderArchive,renderImpulseList(){}}}); work.mount(store);
 await store.start();
 const row=h.$('#taskList').children[0], play=row.querySelector('.play'), menu=row.querySelector('.task-menu'), archive=h.$('#archiveList').children[0];
 await row.querySelector('.more').emit('click'); const action=row.querySelector('[data-task-action]'); action.focus();
 clock=15000; timer.renderPomoTick(); const before=h.$('#pomoTime').textContent;
 setLocale('en');
 const after=h.$('#pomoTime').textContent;
 assert.equal(before, '24:45'); assert.equal(after, before);
 assert.equal(row.querySelector('.play'), play);
 assert.equal(h.$('#archiveList').children[0], archive);
 assert.equal(row.querySelector('.task-menu'), menu);
 assert.equal(menu.classList.contains('hidden'), false);
 assert.equal(feature.isOverflowMenuOpen(), true);
 assert.equal(row.children.includes(h.document.activeElement), true);

 work.dispose();feature.dispose();store.dispose();globalThis.performance=old;
});
