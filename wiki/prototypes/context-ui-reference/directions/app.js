import data from './data.js';
import * as model from './model.js';
import icons from './icons.js';

const STORAGE_KEY = 'mindos-direction-examples-v1';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => icons[name] || '';
const button = (action, label, name, cls = 'plain-button', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${name ? icon(name) : ''}${escape(label)}</button>`;
let state = model.createState();
let storageFailed = false;
try {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) state = model.normalizeState(JSON.parse(raw));
} catch {storageFailed = true;}
const ui = {sourceMessage: '', privateMessage: '', error: '', errorArea: '', copyError: '', copying: false, explanation: false, query: '', reviewFilter: 'all'};
let fileOpener;
let directoryOpener;
let auxOpener = 'source-trigger';
const frame = document.querySelector('#app-frame');
const fileDialog = document.querySelector('#file-dialog');
const directoryDialog = document.querySelector('#directory-dialog');
const queryInputId = () => directoryDialog.open ? 'mobile-search' : 'directory-search';

function persist() {
  try {sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));}
  catch {storageFailed = true;}
  const note = document.querySelector('#storage-note');
  note.hidden = !storageFailed;
  note.textContent = '示例存储不可用；刷新后本页修改不会保留。';
}
function invalidatePreview() {state.prepared = false; state.copied = false; ui.copyError = '';}
function judgmentHint() {
  const saved = state.judgments[state.person];
  return saved && saved !== state.judgmentDrafts[state.person] ? '这次修订尚未保留；本次材料使用先前的已保留版本。' : '可以改成自己的话，并补充适用范围。';
}
function changeRoute(direction = state.direction, view = state.view) {
  const hash = `#${direction}/${view}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}
function choosePerson(id) {
  if (!data.people.some(p => p.id === id)) return;
  if (state.person !== id) {state.person = id; state.selected = ['note','session']; invalidatePreview(); ui.sourceMessage = ''; ui.error = '';}
  state.editing = false;
  if (directoryDialog.open) directoryDialog.close();
  changeRoute(state.direction, 'reading');
  render();
}
function directory(mobile = false) {
  const list = data.people.filter(p => !ui.query || `${p.name}${p.role}${p.focus}`.toLowerCase().includes(ui.query.toLowerCase()));
  return `<div class="panel-heading"><strong>我的空间</strong><span>本地资料</span></div>
    <label class="directory-search">${icon('search')}<span class="visually-hidden">查找示例资料</span><input id="${mobile ? 'mobile-search' : 'directory-search'}" data-input="search" value="${escape(ui.query)}" placeholder="查找资料" aria-label="查找示例资料"></label>
    <div class="panel-section-heading">目录</div>
    <details class="tree-group" data-folder="people" ${state.folders.people ? 'open' : ''}><summary>${icon('chevron')}${icon('folderOpen')}人物</summary><div class="tree-children">${list.map(p => `<button data-person="${p.id}" class="tree-row ${state.person === p.id && state.view === 'reading' ? 'selected' : ''}">${icon('file')}<span>${escape(p.name)}.md</span></button>`).join('')}${list.length ? '' : '<p class="empty-search">没有匹配的资料。换个词试试。</p>'}</div></details>
    <details class="tree-group" data-folder="project" ${state.folders.project ? 'open' : ''}><summary>${icon('chevron')}${icon('folder')}项目</summary><div class="tree-children"><button class="tree-row ${state.view === 'project' ? 'selected' : ''}" data-view="project">${icon('folderOpen')}MindOS 产品打磨</button><button class="tree-row" data-action="raw-csv">${icon('table')}关系总览.csv</button></div></details>
    <div class="panel-section-heading">项目里的视图</div><button class="tree-row ${state.view === 'people' ? 'selected' : ''}" data-view="people">${icon('people')}人脉总览</button><button class="tree-row ${state.view === 'review' ? 'selected' : ''}" data-view="review">${icon('echo')}相关判断</button>
    <div class="panel-bottom"><span>${icon('folder')}原文件始终可打开</span><small>视图围绕资料展开</small></div>`;
}
function rail() {
  return `<nav class="activity-rail" aria-label="示例模块"><div class="rail-logo" aria-hidden="true"><svg viewBox="0 0 80 40" fill="none"><path d="M35 20C25 35 8 35 8 20C8 5 25 5 35 20" stroke="currentColor" stroke-width="3" stroke-dasharray="2 4" stroke-linecap="round"/><path d="M35 20C45 2 75 2 75 20C75 38 45 38 35 20" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg></div>
    <button class="rail-button ${['reading','people'].includes(state.view) ? 'active' : ''}" data-view="reading" aria-label="空间" title="空间">${icon('book')}</button>
    <button class="rail-button ${state.view === 'project' ? 'active' : ''}" data-view="project" aria-label="工作台" title="工作台">${icon('studio')}</button>
    <button class="rail-button ${state.view === 'review' ? 'active' : ''}" data-view="review" aria-label="回响" title="回响">${icon('echo')}</button>
    <button class="rail-button" data-action="materials" aria-label="智能体：准备本次材料" title="智能体：准备本次材料">${icon('bot')}</button>
    <div class="rail-bottom"><button class="rail-button" data-action="help" aria-label="查看方案取舍" title="查看方案取舍">${icon('help')}</button></div></nav>`;
}
function sourcePanel(p) {
  return `<section class="source-panel" aria-labelledby="source-title"><div class="aux-heading"><div><span class="eyebrow">原话与判断</span><h2 id="source-title" tabindex="-1">${escape(p.source.title)}</h2></div>${button('close-aux', '', 'close', 'icon-button', 'aria-label="关闭辅助内容"')}</div>
    <p class="source-meta">${escape(p.source.agent)} · ${escape(p.source.date)} · ${escape(data.project)}</p>
    <div class="source-message"><span>用户原话</span><p>${escape(p.source.user)}</p></div><div class="source-message assistant"><span>助手回复</span><p>${escape(p.source.assistant)}</p></div>
    <div class="judgment-editor"><p class="field-label">${state.judgments[p.id] ? '已保留的判断 · 可修订' : 'AI 候选 · 待你核对'}</p><label for="judgment-draft" class="visually-hidden">我的判断</label><textarea id="judgment-draft" data-input="judgment" maxlength="1000" aria-describedby="judgment-help">${escape(state.judgmentDrafts[p.id])}</textarea><p id="judgment-help" class="helper">${escape(judgmentHint())}</p>
    ${ui.errorArea === 'judgment' ? `<p class="error" role="alert">${escape(ui.error)}</p>` : ''}<div class="editor-actions">${button('save-judgment', '保留这条判断', 'check', 'outline-button')}<span id="source-success" class="success" role="status">${escape(ui.sourceMessage)}</span></div></div></section>`;
}
function materialsPanel() {
  const entries = model.availableEntries(state);
  return `<section class="materials-panel" aria-labelledby="materials-title"><div class="aux-heading"><div><span class="eyebrow">带到下一次工作</span><h2 id="materials-title" tabindex="-1">本次上下文</h2></div>${button('close-aux', '', 'close', 'icon-button', 'aria-label="关闭辅助内容"')}</div>
    <fieldset class="agent-options"><legend>准备给哪个 Agent</legend>${['Codex','Claude Code','Cursor'].map(agent => `<label><input id="agent-${agent.replaceAll(' ', '-')}" type="radio" name="agent" value="${agent}" ${state.target === agent ? 'checked' : ''}>${agent}</label>`).join('')}</fieldset>
    <fieldset class="material-list"><legend>这次带哪些材料</legend>${entries.map(entry => `<label class="material-row"><input id="material-${entry.id}" type="checkbox" data-material="${entry.id}" ${state.selected.includes(entry.id) ? 'checked' : ''} aria-label="带上${entry.id === 'judgment' ? '已保留的判断' : entry.title}"><span><strong>${escape(entry.title)}</strong><small class="font-mono">${escape(entry.path)}</small></span></label>`).join('')}</fieldset>
    <p class="helper">${state.judgments[state.person] ? '' : '候选判断核对后才能选入。'}私人观察不在本次材料中。</p>
    ${ui.errorArea === 'materials' ? `<p class="error" role="alert">${escape(ui.error)}</p>` : ''}
    ${button('prepare', '查看带走的内容', 'list', 'outline-button')}
    ${state.prepared ? `<div class="context-preview"><label for="context-text" class="field-label">材料预览</label><textarea id="context-text" aria-label="材料预览" readonly>${escape(model.contextText(state))}</textarea><div class="preview-footer"><span>${model.contextEntries(state).length} 项材料 · 仅已准备预览</span>${button('copy', ui.copying ? '正在复制…' : '复制材料', 'copy', 'primary-button', ui.copying ? 'disabled' : '')}</div><p class="success" role="status">${state.copied ? '已复制材料；外部接收尚未确认。' : ''}</p>${ui.copyError ? `<p class="error" role="alert">${escape(ui.copyError)}</p>` : ''}</div>` : ''}</section>`;
}
function auxContent() {return state.aux === 'source' ? sourcePanel(model.person(state)) : state.aux === 'materials' ? materialsPanel() : '';}
function interactionForm(p) {
  if (!state.editing) return '';
  return `<form class="interaction-form" id="interaction-form"><h3>记下这次互动</h3><label for="interaction-date" class="field-label">互动日期</label><input id="interaction-date" type="date" data-input="date" value="${state.interactionDates[p.id] || data.date}" aria-label="互动日期"><label for="interaction-draft" class="field-label">互动记录</label><textarea id="interaction-draft" data-input="interaction" maxlength="1000" placeholder="聊了什么，下次接着做什么？">${escape(state.interactionDrafts[p.id] || '')}</textarea>${ui.errorArea === 'interaction' ? `<p class="error" role="alert">${escape(ui.error)}</p>` : ''}<div class="editor-actions"><button class="primary-button" type="submit">保存互动</button>${button('cancel-interaction','取消记录',null,'text-button')}</div></form>`;
}
function timeline(p) {
  const records = [...(state.interactions[p.id] || []), ...p.history];
  return `<section class="timeline-section"><div class="section-heading"><h2>互动记录</h2>${button('add-interaction','记录一次互动','plus','text-button','id="interaction-trigger"')}</div>${interactionForm(p)}<ol class="timeline">${records.map((r,i) => `<li><div class="timeline-date">${escape(r.date)}<small>${i < (state.interactions[p.id]?.length || 0) ? '本页新增' : escape(r.type || '交流记录')}</small></div><p>${escape(r.text)}</p></li>`).join('')}</ol></section>`;
}
function profile(p, object = false) {
  return `<article class="profile ${object ? 'object-profile' : 'document-profile'}"><header class="profile-heading">${object ? `<div class="person-avatar">${escape(p.initials)}</div>` : ''}<div><p class="content-kind">${object ? '人物' : '人物资料'}</p><h1>${escape(p.name)}</h1><p class="person-role">${escape(p.role)}<span>${escape(p.focus)}</span></p></div></header>
    <p class="profile-lead">${escape(p.summary)}</p>
    ${object ? `<dl class="person-fields"><div><dt>所属项目</dt><dd>${escape(data.project)}</dd></div><div><dt>下次跟进</dt><dd>${escape(p.followup)}<span>${escape(p.next)}</span></dd></div></dl>` : ''}
    <section class="reading-section"><h2>我们是怎么认识的</h2><p class="font-reading">${escape(p.background)}</p></section>
    <section class="reading-section"><h2>最近聊过什么</h2><p class="font-reading">${escape(p.discussion)}</p><div class="source-inline-hint">${icon('source')}<span>${escape(p.source.agent)} · ${escape(p.source.date)}</span>${button('source','查看原会话',null,'text-button','id="source-trigger" aria-expanded="'+String(state.aux === 'source')+'"')}</div></section>
    ${state.aux && state.direction !== 'b' ? `<div class="inline-aux">${auxContent()}</div>` : ''}
    ${state.judgments[p.id] ? `<section class="saved-judgment"><span>${icon('check')}我的判断 · 已保留</span><p>${escape(state.judgments[p.id])}</p>${button('source','核对或修订',null,'text-button')}</section>` : ''}
    ${object ? '' : `<section class="reading-section next-step"><h2>下次接着做</h2><p>${escape(p.next)}</p><small>计划 ${escape(p.followup)}</small></section>`}
    ${timeline(p)}
    <div class="file-origin">${icon('file')}<span class="font-mono">${escape(p.path)}</span>${button('raw-file','查看原文件',null,'text-button')}</div></article>`;
}
function personList() {
  return `<aside class="person-list" aria-label="示例人物列表"><div class="person-list-heading"><h2>人脉</h2><span>${data.people.length} 位人物</span></div><p>按下次跟进排序</p>${data.people.map(p => `<button class="person-list-row ${state.person === p.id ? 'selected' : ''}" data-person="${p.id}" aria-pressed="${state.person === p.id}"><span class="list-avatar">${escape(p.initials)}</span><span><strong>${escape(p.name)}</strong><small>${escape(p.role)}</small><small>${escape(p.followup.slice(5).replace('-', ' / '))} 跟进</small></span></button>`).join('')}<div class="list-origin">${icon('table')}<span>关系总览.csv</span>${button('raw-csv','核对资料',null,'text-button')}</div></aside>`;
}
function projectContent() {
  const p = model.person(state);
  return `<article class="workbench-content"><header><p class="content-kind">项目</p><h1>${escape(data.project)}</h1><p class="profile-lead">把相关人物、讨论与下一步工作放在一起。</p></header><section class="project-continue"><span>继续上次内容</span><h2>${escape(p.name)}</h2><p>${escape(p.next)}</p><button class="outline-button" data-person="${p.id}">${icon('book')}继续阅读</button></section><div class="section-heading"><h2>项目资料</h2><button class="text-button" data-view="people">${icon('people')}用人脉视图查看</button></div><div class="project-files">${data.people.map(person => `<button data-person="${person.id}">${icon('file')}<span><strong>${escape(person.name)}.md</strong><small>${escape(person.role)}</small></span>${icon('right')}</button>`).join('')}<button data-action="raw-csv">${icon('table')}<span><strong>关系总览.csv</strong><small>同一组人物的字段与跟进</small></span>${icon('right')}</button></div><div class="project-bottom"><button class="text-button" data-view="review">${icon('echo')}回看相关判断</button>${button('materials','准备本次材料','bot','text-button')}</div>${state.aux && state.direction !== 'b' ? `<div class="inline-aux">${auxContent()}</div>` : ''}</article>`;
}
function peopleContent() {
  if (state.direction === 'c') return `<div class="object-workspace">${personList()}${profile(model.person(state), true)}</div>`;
  return `<article class="workbench-content"><p class="content-kind">项目里的视图</p><h1>人脉总览</h1><p class="profile-lead">同一份资料，用列表查看和选择。</p><table class="people-table" aria-label="示例人物与下次跟进"><thead><tr><th scope="col">人物</th><th scope="col">关注方向</th><th scope="col">下次跟进</th></tr></thead><tbody>${data.people.map(p => `<tr><td><button data-person="${p.id}"><strong>${escape(p.name)}</strong><small>${escape(p.role)}</small></button></td><td>${escape(p.focus)}</td><td>${escape(p.followup)}</td></tr>`).join('')}</tbody></table><div class="file-origin">${icon('table')}<span class="font-mono">关系总览.csv</span>${button('raw-csv','查看原文件',null,'text-button')}</div>${state.aux && state.direction !== 'b' ? `<div class="inline-aux">${auxContent()}</div>` : ''}</article>`;
}
function reviewContent() {
  const p = model.person(state);
  return `<article class="workbench-content review-content"><p class="content-kind">回响</p><h1>从这段交流里，保留自己的判断。</h1><p class="profile-lead">原话是依据，提炼是候选，核对之后再留给下一次工作。</p><div class="review-record"><div class="review-record-meta"><span>${state.judgments[p.id] ? '已保留 · 可修订' : '候选 · 待核对'}</span><span>${escape(p.source.date)}</span></div><h2>${escape(p.name)} · ${escape(p.source.title)}</h2><p>${escape(state.judgments[p.id] || p.candidate)}</p>${button('source','核对原话与判断','source','outline-button','id="source-trigger"')}</div>${state.aux && state.direction !== 'b' ? `<div class="inline-aux">${auxContent()}</div>` : ''}<section class="private-observation"><h2>自己的观察</h2><p>后来怎么用，结果怎样？这段留给自己。</p><label for="private-draft" class="visually-hidden">私人观察</label><textarea id="private-draft" data-input="private" maxlength="1000" placeholder="在一次真实尝试之后，再补充结果。">${escape(state.privateDrafts[p.id] || '')}</textarea>${ui.errorArea === 'private' ? `<p class="error" role="alert">${escape(ui.error)}</p>` : ''}<div class="editor-actions">${button('save-private','记下观察',null,'outline-button')}<span class="success" role="status">${escape(ui.privateMessage)}</span></div></section></article>`;
}
function render(focusId) {
  const p = model.person(state);
  const direction = data.directions.find(d => d.id === state.direction);
  const object = state.direction === 'c' && state.view === 'reading';
  let body = state.view === 'project' ? projectContent() : state.view === 'people' ? peopleContent() : state.view === 'review' ? reviewContent() : object ? `<div class="object-workspace">${personList()}${profile(p, true)}</div>` : profile(p);
  const hasSidebar = state.sidebarVisible;
  frame.dataset.direction = state.direction;
  frame.classList.toggle('sidebar-hidden', !hasSidebar);
  frame.setAttribute('aria-labelledby', `direction-${state.direction}`);
  frame.innerHTML = `${rail()}<aside class="directory-panel" ${hasSidebar ? '' : 'hidden'} aria-label="示例资料目录">${directory()}</aside><div class="workspace" id="workspace" tabindex="-1"><header class="workspace-tabs"><button class="icon-button desktop-directory" data-action="toggle-sidebar" aria-label="${hasSidebar ? '收起目录' : '展开目录'}">${icon('panel')}</button><button class="icon-button mobile-directory" data-action="directory" aria-label="打开目录">${icon('panel')}</button><div class="file-tabs" role="group" aria-label="示例工作标签"><button class="${state.view === 'reading' ? 'selected' : ''}" data-view="reading">${icon('file')}${escape(p.name)}.md</button><button class="${state.view === 'people' ? 'selected' : ''}" data-view="people">${icon('people')}人脉总览</button><button class="${state.view === 'project' ? 'selected' : ''}" data-view="project">${icon('folder')}项目</button></div></header><div class="workspace-toolbar"><div class="breadcrumb"><span>${escape(data.project)}</span>${icon('right')}<span>${state.view === 'review' ? '回响' : '人物'}</span></div>${button('materials','准备给 Agent','bot','primary-button','id="materials-trigger"')}</div><div class="work-split ${state.direction === 'b' && state.aux ? 'has-inspector' : ''}"><div class="content-surface">${body}</div>${state.direction === 'b' && state.aux ? `<aside class="inspector" aria-label="与当前内容相关的辅助区">${auxContent()}</aside>` : ''}</div></div>`;
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  document.querySelector('#theme-toggle').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
  document.querySelector('#theme-toggle').setAttribute('aria-label', state.theme === 'dark' ? '切换浅色主题' : '切换深色主题');
  document.querySelector('#direction-caption').textContent = direction.tagline;
  document.querySelectorAll('button[data-direction]').forEach(tab => {const selected = tab.dataset.direction === state.direction; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;});
  document.querySelector('#design-explanation').innerHTML = `<div><strong>${escape(direction.name)} · ${escape(direction.level)}</strong><p>${escape(direction.note)}</p></div><div class="reference-links">${direction.references.map(([label,url]) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`).join('')}</div>`;
  document.title = `${direction.name} · MindOS 三种界面方案`;
  persist();
  if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
}
function openAux(kind) {
  state.aux = kind;
  auxOpener = kind === 'source' ? 'source-trigger' : 'materials-trigger';
  ui.error = ''; ui.errorArea = ''; render();
  const title = document.getElementById(kind === 'source' ? 'source-title' : 'materials-title');
  title?.focus({preventScroll:true});
  title?.scrollIntoView({block: 'nearest'});
}
function openRaw(csv = false) {
  fileOpener = document.activeElement;
  document.querySelector('#file-dialog-title').textContent = csv ? '关系总览.csv · 示例原文件' : model.person(state).path;
  document.querySelector('#raw-file').value = csv ? '姓名,背景,下次跟进,下一步\n' + data.people.map(p => `${p.name},${p.role},${p.followup},${p.next}`).join('\n') : model.markdown(state);
  fileDialog.showModal();
}
async function copyMaterials() {
  if (!state.prepared || ui.copying) return;
  const text = model.contextText(state);
  ui.copying = true; ui.copyError = ''; render();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 4000))]);
    if (text === model.contextText(state)) state.copied = true;
  } catch {ui.copyError = '复制失败，请在预览中选取内容后手动复制。';}
  finally {ui.copying = false; render('context-text');}
}
function act(action) {
  ui.error = ''; ui.errorArea = '';
  switch (action) {
    case 'source': openAux('source'); break;
    case 'materials': openAux('materials'); break;
    case 'close-aux': state.aux = null; render(auxOpener); break;
    case 'raw-file': openRaw(); break;
    case 'raw-csv': openRaw(true); break;
    case 'save-judgment':
      try {state = model.saveJudgment(state, state.judgmentDrafts[state.person]); ui.sourceMessage = '已保留这条判断';}
      catch (error) {ui.error = error.message; ui.errorArea = 'judgment';}
      render('judgment-draft'); break;
    case 'save-private':
      try {state.privateSaved[state.person] = model.validateText(state.privateDrafts[state.person], '观察'); ui.privateMessage = '已记下，仅留给自己';}
      catch (error) {ui.error = error.message; ui.errorArea = 'private';}
      render('private-draft'); break;
    case 'add-interaction': state.editing = true; render('interaction-draft'); document.querySelector('#interaction-draft')?.scrollIntoView({block:'nearest'}); break;
    case 'cancel-interaction': state.editing = false; render('interaction-trigger'); break;
    case 'prepare':
      if (!model.contextEntries(state).length) {ui.error = '先选择至少一项材料。'; ui.errorArea = 'materials';}
      else {state.prepared = true; state.copied = false;}
      render(state.prepared ? 'context-text' : undefined); break;
    case 'copy': void copyMaterials(); break;
    case 'toggle-sidebar': state.sidebarVisible = !state.sidebarVisible; render(); break;
    case 'directory': directoryOpener = document.activeElement; document.querySelector('#mobile-directory').innerHTML = directory(true); directoryDialog.showModal(); break;
    case 'help': document.querySelector('#explain-toggle').click(); break;
  }
}
frame.addEventListener('click', event => {
  const person = event.target.closest('[data-person]');
  const view = event.target.closest('[data-view]');
  const action = event.target.closest('[data-action]');
  if (person) choosePerson(person.dataset.person);
  else if (view) {state.editing = false; changeRoute(state.direction, view.dataset.view);}
  else if (action && !action.disabled) act(action.dataset.action);
});
directoryDialog.addEventListener('click', event => {
  const person = event.target.closest('[data-person]');
  const view = event.target.closest('[data-view]');
  const action = event.target.closest('[data-action]');
  if (person) choosePerson(person.dataset.person);
  else if (view) {directoryDialog.close(); changeRoute(state.direction, view.dataset.view);}
  else if (action) {directoryDialog.close(); act(action.dataset.action);}
});
function handleInput(event) {
  const key = event.target.dataset.input;
  const value = event.target.value;
  if (key === 'search') {
    ui.query = value;
    const activeId = queryInputId();
    if (directoryDialog.open) document.querySelector('#mobile-directory').innerHTML = directory(true);
    else render();
    const input = document.getElementById(activeId); input?.focus({preventScroll:true}); input?.setSelectionRange(value.length, value.length);
    return;
  }
  if (key === 'judgment') {
    state.judgmentDrafts[state.person] = value; ui.sourceMessage = '';
    document.querySelector('#judgment-help').textContent = judgmentHint();
    document.querySelector('#source-success').textContent = '';
  }
  if (key === 'private') state.privateDrafts[state.person] = value;
  if (key === 'interaction') state.interactionDrafts[state.person] = value;
  if (key === 'date') state.interactionDates[state.person] = value;
  persist();
}
frame.addEventListener('input', handleInput);
directoryDialog.addEventListener('input', handleInput);
frame.addEventListener('change', event => {
  if (event.target.dataset.material) {
    const id = event.target.dataset.material;
    state.selected = event.target.checked ? [...new Set([...state.selected, id])] : state.selected.filter(entry => entry !== id);
    invalidatePreview(); render(`material-${id}`);
  } else if (event.target.name === 'agent') {state.target = event.target.value; invalidatePreview(); render(event.target.id);}
});
function rememberFolder(event) {
  const folder = event.target.dataset.folder;
  if (!folder || !event.target.isConnected) return;
  state.folders[folder] = event.target.open; persist();
}
frame.addEventListener('toggle', rememberFolder, true);
directoryDialog.addEventListener('toggle', rememberFolder, true);
frame.addEventListener('submit', event => {
  if (event.target.id !== 'interaction-form') return;
  event.preventDefault();
  try {state = model.saveInteraction(state, state.interactionDrafts[state.person], state.interactionDates[state.person] || data.date); ui.error = ''; ui.errorArea = '';}
  catch (error) {ui.error = error.message; ui.errorArea = 'interaction';}
  render(state.editing ? 'interaction-draft' : 'interaction-trigger');
});
document.querySelectorAll('button[data-direction]').forEach(tab => tab.addEventListener('click', () => changeRoute(tab.dataset.direction)));
document.querySelector('.direction-tabs').addEventListener('keydown', event => {
  if (event.isComposing || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('button[data-direction]')];
  const index = tabs.indexOf(document.activeElement); if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
});
document.querySelector('#theme-toggle').addEventListener('click', () => {state.theme = state.theme === 'light' ? 'dark' : 'light'; render();});
document.querySelector('#explain-toggle').addEventListener('click', () => {
  ui.explanation = !ui.explanation;
  document.querySelector('#design-explanation').hidden = !ui.explanation;
  document.querySelector('#explain-toggle').setAttribute('aria-expanded', String(ui.explanation));
});
document.querySelector('#reset-example').addEventListener('click', () => {
  state = model.createState(); Object.assign(ui, {sourceMessage:'', privateMessage:'', error:'', errorArea:'', copyError:'', copying:false, query:''});
  changeRoute('a','reading'); render();
});
document.querySelector('#close-file').innerHTML = icon('close');
document.querySelector('#close-directory').innerHTML = icon('close');
document.querySelector('#close-file').addEventListener('click', () => fileDialog.close());
document.querySelector('#close-directory').addEventListener('click', () => directoryDialog.close());
fileDialog.addEventListener('close', () => {if (fileOpener?.isConnected) fileOpener.focus({preventScroll:true});});
directoryDialog.addEventListener('close', () => {if (directoryOpener?.isConnected) directoryOpener.focus({preventScroll:true});});
function readRoute() {
  if (location.hash === '#workspace') return;
  const route = location.hash ? model.parseRoute(location.hash) : {direction:state.direction, view:state.view};
  const previousDirection = state.direction;
  if (state.direction !== route.direction) {ui.error = ''; ui.errorArea = '';}
  state.direction = route.direction; state.view = route.view;
  if (state.direction === 'b' && previousDirection !== 'b' && !state.aux) state.aux = 'source';
  render();
}
window.addEventListener('hashchange', readRoute);
readRoute();
