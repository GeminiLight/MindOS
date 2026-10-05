const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');

test('confirmed judgment appears as a separate selectable item with its original source', () => {
  let state = model.createState();
  state = model.saveJudgment(state, '先保留目录，在当前内容上加来源。');
  state.selected = ['note', 'session', 'judgment'];
  const entries = model.contextEntries(state);
  assert.equal(entries.length, 3);
  assert.equal(entries[2].title, '已保留的判断');
  assert.match(entries[2].body, /先保留目录/);
  assert.match(entries[2].path, /判断/);
  assert.equal(state.prepared, false);
});
test('private observations stay out of every material preview even if a stale selection asks for them', () => {
  const state = model.createState();
  state.privateDrafts.lin = '私人内容绝不带出';
  state.selected = ['note', 'session', 'private', 'judgment'];
  const text = model.contextText(state);
  assert.doesNotMatch(text, /私人内容绝不带出/);
  assert.equal(model.contextEntries(state).length, 2);
});
test('interaction updates the chosen person while other people keep their own records', () => {
  let state = model.createState();
  state = model.saveInteraction(state, '看了三种界面，先试最小变化。', '2026-10-03');
  assert.equal(state.interactions.lin.length, 1);
  assert.equal(state.interactions.chen, undefined);
  assert.match(model.contextText(state), /看了三种界面/);
  assert.equal(state.prepared, false);
});
test('whitespace-only and oversized edits return a useful validation error', () => {
  const state = model.createState();
  assert.throws(() => model.saveJudgment(state, '  \n '), /写下/);
  assert.throws(() => model.saveInteraction(state, 'a'.repeat(1001), '2026-10-03'), /1000/);
  assert.throws(() => model.saveJudgment(state, null), /写下/);
});
test('impossible dates cannot create a timeline entry', () => {
  assert.throws(() => model.saveInteraction(model.createState(), '一条互动', '2026-02-30'), /日期/);
  assert.throws(() => model.saveInteraction(model.createState(), '一条互动', 'invalid'), /日期/);
});
test('damaged storage and unknown routes recover to a usable default', () => {
  assert.equal(model.normalizeState(null).person, 'lin');
  const state = model.normalizeState({person: '../private', direction: 'unknown', selected: ['private'], interactions: 'broken'});
  assert.equal(state.person, 'lin');
  assert.equal(state.direction, 'a');
  assert.deepEqual(state.interactions, {});
  assert.deepEqual(model.parseRoute('#unknown/unknown'), {direction: 'a', view: 'reading'});
});
test('valid Unicode drafts and saved example entries survive state restoration', () => {
  let state = model.createState();
  state.judgmentDrafts.lin = '目录保留 📚，先处理这一份资料';
  state = model.saveInteraction(state, '再次核对来源', '2026-10-03');
  const restored = model.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.judgmentDrafts.lin, state.judgmentDrafts.lin);
  assert.equal(restored.interactions.lin[0].text, '再次核对来源');
});
test('an unsaved revision cannot silently replace the confirmed judgment in context', () => {
  let state = model.saveJudgment(model.createState(), '已经核对的版本');
  state.judgmentDrafts.lin = '还没有保留的修订';
  state.selected = ['judgment'];
  assert.match(model.contextText(state), /已经核对的版本/);
  assert.doesNotMatch(model.contextText(state), /还没有保留的修订/);
});
