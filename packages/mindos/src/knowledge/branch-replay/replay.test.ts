import { describe, expect, it } from 'vitest';
import { createReplayState, transitionReplay, validateBranchStory, extractBranchStory, type ReplaySource } from './index.js';

const source: ReplaySource = {
  id: 's1', runtime: 'codex', title: '保留文件树还是重做工作台', project: 'MindOS', updatedAt: 100,
  messages: [
    { id: 'm0', role: 'user', text: '我们想让用户管理上下文，保留资料的来源。' },
    { id: 'm1', role: 'assistant', text: '我建议重新设计工作台首页，重新安排导航和内容组织。' },
    { id: 'm2', role: 'user', text: '工作台的设计好怪，变化还是太大。保留原来的文件树。' },
    { id: 'm3', role: 'assistant', text: '建议保留树状知识库和现有布局，整合资料、对话和复盘的关系。' },
    { id: 'm4', role: 'user', text: '这个方向可以，先沿着现有布局打磨。' },
  ],
};
function draft() {
  return { title: '一次产品方向的纠偏', summary: '在原有界面与改版之间做取舍。', scenes: [{
    id: 'fork-1', title: '这次改到什么程度？', context: '已有文件树和工作台，需要更好地管理上下文。',
    evidence: [{ messageId: 'm0', quote: '保留资料的来源' }],
    choices: [
      { id: 'a', label: '重做工作台', description: '重新安排导航与内容组织。', proposal: { messageId: 'm1', quote: '重新设计工作台首页' }, outcome: { kind: 'recorded', title: '用户提出了新的约束', steps: [{ title: '变化太大', text: '用户要求保留文件树。', refs: [{ messageId: 'm2', quote: '变化还是太大' }] }] } },
      { id: 'b', label: '保留文件树', description: '在现有布局中整合。', proposal: { messageId: 'm3', quote: '保留树状知识库和现有布局' }, outcome: { kind: 'recorded', title: '方向获得认可', steps: [{ title: '继续打磨', text: '用户接受继续沿现有布局打磨。', refs: [{ messageId: 'm4', quote: '这个方向可以' }] }] } },
      { id: 'c', label: '另一种做法', description: '留作待验证想法。', proposal: { messageId: 'm1', quote: '工作台首页' }, outcome: { kind: 'unobserved', title: '还没有结果', steps: [] } },
    ],
  }] };
}

describe('source-grounded branching stories', () => {
  it('turns explicit A/B proposals into routes without requiring a user correction', () => {
    const value: ReplaySource = { ...source, id: 'options', messages: [
      {id:'m0',role:'user',text:'切换项目后出现旧内容，应该怎样排查？'},
      {id:'m1',role:'assistant',text:'方案 A：清理缓存\n移除已经保存的旧数据。\n\n方案 B：校验请求归属\n只允许当前轮次更新页面。'},
      {id:'m2',role:'assistant',text:'尝试清理缓存后，旧内容仍然出现，验证失败。'},
    ] };
    const story=extractBranchStory(value);
    expect(story?.scenes[0].choices.map(c=>c.label)).toEqual(['清理缓存','校验请求归属']);
    expect(story?.scenes[0].choices[0].outcome.kind).toBe('recorded');
    expect(story?.scenes[0].choices[1].outcome.kind).toBe('unobserved');
  });
  it('does not turn suggested or hypothetical outcomes into recorded execution', () => {
    const value:ReplaySource={...source,messages:[
      {id:'m0',role:'user',text:'应该怎样处理这个问题？'},
      {id:'m1',role:'assistant',text:'A. 清理缓存\nB. 校验请求归属'},
      {id:'m2',role:'assistant',text:'如果尝试清理缓存，可能会成功。建议采用校验请求归属。'},
    ]};
    expect(extractBranchStory(value)?.scenes[0].choices.every(c=>c.outcome.kind==='unobserved')).toBe(true);
  });
  it('keeps real evidence and distinguishes an unobserved alternative', () => {
    const story = validateBranchStory(source, draft());
    expect(story.source.id).toBe('s1');
    expect(story.scenes[0].choices[2].outcome.kind).toBe('unobserved');
    expect(story.scenes[0].evidence[0].quote).toBe('保留资料的来源');
  });
  it('rejects invented quotes and missing message references', () => {
    const bad = draft(); bad.scenes[0].evidence[0].quote = '测试证明性能提高了';
    expect(() => validateBranchStory(source, bad)).toThrow(/source|quote/i);
    const missing = draft(); missing.scenes[0].evidence[0].messageId = 'missing';
    expect(() => validateBranchStory(source, missing)).toThrow(/source|message/i);
  });
  it('refuses to present unsupported outcomes as recorded results', () => {
    const bad = draft(); bad.scenes[0].choices[0].outcome.steps[0].refs = [];
    expect(() => validateBranchStory(source, bad)).toThrow(/evidence|ref/i);
  });
  it('finds a real correction without turning an empty session into a story', () => {
    const story = extractBranchStory(source);
    expect(story?.scenes.length).toBeGreaterThan(0);
    expect(story?.scenes[0].choices.length).toBe(2);
    expect(extractBranchStory({ ...source, messages: [] })).toBeNull();
    expect(extractBranchStory({ ...source, messages: [{ id: 'm0', role: 'user', text: '你好' }] })).toBeNull();
  });
  it('handles Unicode and rejects oversized or ambiguous scene identities', () => {
    const bad = draft(); bad.scenes.push({ ...bad.scenes[0] });
    expect(() => validateBranchStory(source, bad)).toThrow(/duplicate|unique/i);
    const long = draft(); long.title = '字'.repeat(2000);
    expect(() => validateBranchStory(source, long)).toThrow();
  });
});

describe('human exploration and backtracking', () => {
  it('reveals results one step at a time and preserves both attempts after rewind', () => {
    const story = validateBranchStory(source, draft());
    let state = createReplayState(story);
    expect(state.phase).toBe('choice');
    state = transitionReplay(story, state, { type: 'choose', choiceId: 'a' });
    expect(state.visibleSteps).toBe(0);
    state = transitionReplay(story, state, { type: 'advance' });
    expect(state.visibleSteps).toBe(1);
    state = transitionReplay(story, state, { type: 'rewind' });
    expect(state.phase).toBe('choice');
    expect(state.attempts[0]).toMatchObject({ choiceId: 'a', visibleSteps: 1 });
    state = transitionReplay(story, state, { type: 'choose', choiceId: 'b' });
    expect(state.attempts).toHaveLength(2);
  });
  it('refuses illegal choices and does not reveal unsupported results', () => {
    const story = validateBranchStory(source, draft());
    const initial = createReplayState(story);
    expect(() => transitionReplay(story, initial, { type: 'choose', choiceId: 'missing' })).toThrow();
    const unknown = transitionReplay(story, initial, { type: 'choose', choiceId: 'c' });
    expect(unknown.phase).toBe('unobserved');
    expect(transitionReplay(story, unknown, { type: 'advance' }).visibleSteps).toBe(0);
  });
  it('revisits a previous attempt without duplicating it and does not mutate old state', () => {
    const story = validateBranchStory(source, draft());
    const initial = createReplayState(story);
    const chosen = transitionReplay(story, initial, { type: 'choose', choiceId: 'a' });
    const back = transitionReplay(story, chosen, { type: 'rewind' });
    const again = transitionReplay(story, back, { type: 'choose', choiceId: 'a' });
    expect(again.attempts).toHaveLength(1);
    expect(initial.attempts).toEqual([]);
  });
});
