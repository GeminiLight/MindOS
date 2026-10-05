import data from './data.js';
  const ids = data.people.map(p => p.id);
  const directions = ['a', 'b', 'c'];
  const views = ['reading', 'project', 'people', 'review'];
  const materialIds = ['note', 'session', 'judgment'];
  const clampText = value => typeof value === 'string' ? [...value].slice(0, 1000).join('') : '';
  function createState() {
    return {version: 1, direction: 'a', view: 'reading', person: 'lin', theme: 'light', aux: null,
      judgmentDrafts: Object.fromEntries(data.people.map(p => [p.id, p.candidate])), privateDrafts: {}, privateSaved: {},
      judgments: {}, interactions: {}, interactionDrafts: {}, interactionDates: {}, selected: ['note', 'session'],
      target: 'Codex', prepared: false, copied: false, editing: false, sidebarVisible: true, folders: {people:true, project:true}, query: ''};
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function stringMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(ids.filter(id => typeof value[id] === 'string').map(id => [id, clampText(value[id])]));
  }
  function normalizeState(raw) {
    const state = createState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.version !== undefined && raw.version !== 1)) return state;
    for (const [key, allowed] of [['direction', directions], ['view', views], ['person', ids], ['theme', ['light','dark']], ['target', ['Codex','Claude Code','Cursor']]]) {
      if (allowed.includes(raw[key])) state[key] = raw[key];
    }
    for (const key of ['privateDrafts','privateSaved','judgments','interactionDrafts']) state[key] = stringMap(raw[key]);
    state.judgmentDrafts = {...state.judgmentDrafts, ...stringMap(raw.judgmentDrafts)};
    if (raw.interactions && typeof raw.interactions === 'object' && !Array.isArray(raw.interactions)) {
      for (const id of ids) if (Array.isArray(raw.interactions[id])) {
        state.interactions[id] = raw.interactions[id].slice(0, 100).filter(r => r && validDate(r.date) && typeof r.text === 'string' && r.text.trim()).map(r => ({date: r.date, text: clampText(r.text)}));
      }
    }
    state.interactionDates = Object.fromEntries(Object.entries(stringMap(raw.interactionDates)).filter(([,v]) => validDate(v)));
    if (Array.isArray(raw.selected)) state.selected = [...new Set(raw.selected.filter(id => materialIds.includes(id)))];
    if (['source','materials'].includes(raw.aux)) state.aux = raw.aux;
    if (typeof raw.sidebarVisible === 'boolean') state.sidebarVisible = raw.sidebarVisible;
    for (const key of ['people','project']) if (typeof raw.folders?.[key] === 'boolean') state.folders[key] = raw.folders[key];
    // A restored preview needs fresh confirmation; a clipboard result cannot be inferred from storage.
    state.prepared = false;
    state.copied = false;
    return state;
  }
  function validateText(text, label) {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`请先写下${label}。`);
    if ([...text].length > 1000) throw new Error(`${label}请控制在 1000 字以内。`);
    return text.trim();
  }
  function saveJudgment(state, text) {
    const value = validateText(text, '判断');
    return {...state, judgments: {...state.judgments, [state.person]: value}, judgmentDrafts: {...state.judgmentDrafts, [state.person]: value}, prepared: false, copied: false};
  }
  function saveInteraction(state, text, date) {
    const value = validateText(text, '互动记录');
    if (!validDate(date)) throw new Error('请选择有效的互动日期。');
    return {...state, interactions: {...state.interactions, [state.person]: [{date, text: value}, ...(state.interactions[state.person] || [])]},
      interactionDrafts: {...state.interactionDrafts, [state.person]: ''}, editing: false, prepared: false, copied: false};
  }
  function person(state) {return data.people.find(p => p.id === state.person) || data.people[0];}
  function markdown(state) {
    const p = person(state);
    const records = [...(state.interactions[p.id] || []), ...p.history];
    return `# ${p.name}\n\n${p.role}\n${p.focus}\n\n## 背景\n${p.background}\n\n## 最近讨论\n${p.discussion}\n\n## 下次跟进\n${p.next}\n计划：${p.followup}\n\n## 互动记录\n${records.map(r => `- ${r.date}：${r.text}`).join('\n')}`;
  }
  function availableEntries(state) {
    const p = person(state);
    const entries = [
      {id: 'note', title: '人物资料', path: p.path, body: markdown(state)},
      {id: 'session', title: '相关会话节选', path: `${p.source.agent} / ${p.source.title} / ${p.source.date}`, body: `用户：${p.source.user}\n助手：${p.source.assistant}`}
    ];
    if (state.judgments[p.id]?.trim()) entries.push({id: 'judgment', title: '已保留的判断', path: `判断/${p.name}.md`, body: state.judgments[p.id]});
    return entries;
  }
  function contextEntries(state) {return availableEntries(state).filter(entry => state.selected.includes(entry.id));}
  function contextText(state) {
    return `为 ${state.target} 准备的材料\n项目：${data.project}\n\n` + contextEntries(state).map(entry => `## ${entry.title}\n来源：${entry.path}\n\n${entry.body}`).join('\n\n---\n\n');
  }
  function parseRoute(hash) {
    const [direction, view] = String(hash || '').replace(/^#/, '').split('/');
    return {direction: directions.includes(direction) ? direction : 'a', view: views.includes(view) ? view : 'reading'};
  }
export {createState, normalizeState, saveJudgment, saveInteraction, person, markdown, availableEntries, contextEntries, contextText, parseRoute, validateText};
