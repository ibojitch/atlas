/* Workspace switching and independent unsaved-state management. */
(function (root, factory) {
  const api = factory(root && root.document ? root : null);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WorkspaceShell = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (browser) {
  'use strict';
  function createState() { return { active: 'atlas', atlas: { dirty: false }, line: { dirty: false } }; }
  function validWorkspace(name) { if (!['atlas', 'line'].includes(name)) throw new Error('不明なworkspaceです。'); }
  function setDirtyState(state, name, dirty) { validWorkspace(name); state[name].dirty = !!dirty; return state; }
  function hasUnsavedChanges(state) { return !!(state.atlas.dirty || state.line.dirty); }
  if (!browser || !browser.document.getElementById('workspace-atlas')) return { createState, setDirtyState, hasUnsavedChanges };

  const state = createState(), unsafeCheckers = new Map();
  const $ = id => browser.document.getElementById(id);
  function render() {
    for (const name of ['atlas', 'line']) {
      const active = state.active === name;
      $(`${name}Workspace`).hidden = !active;
      $(`workspace-${name}`).classList.toggle('active', active);
      $(`workspace-${name}`).setAttribute('aria-selected', String(active));
      const status = $(`${name}SaveState`);
      status.textContent = state[name].dirty ? '● 未保存' : '保存済み';
      status.classList.toggle('dirty', state[name].dirty);
    }
    browser.document.title = `${state.active === 'atlas' ? 'Sprite Atlas' : 'LINEスタンプ'} — ローカル画像制作ツール`;
  }
  function switchWorkspace(name) { validWorkspace(name); state.active = name; render(); }
  function setDirty(name, dirty = true) { setDirtyState(state, name, dirty); render(); }
  function isDirty(name) { validWorkspace(name); return state[name].dirty; }
  function confirmDestructive(name) { return !isDirty(name) || browser.confirm('未保存の変更があります。\n保存せずに続行しますか？'); }
  function setUnsafeChecker(name, checker) { unsafeCheckers.set(name, checker); }
  function hasUnsafeOperation() { return Array.from(unsafeCheckers.values()).some(checker => checker()); }
  for (const name of ['atlas', 'line']) $(`workspace-${name}`).addEventListener('click', () => switchWorkspace(name));
  browser.addEventListener('beforeunload', event => {
    if (hasUnsavedChanges(state) || hasUnsafeOperation()) { event.preventDefault(); event.returnValue = ''; }
  });
  render();
  return { state, createState, setDirtyState, hasUnsavedChanges: () => hasUnsavedChanges(state), switchWorkspace, setDirty, isDirty, confirmDestructive, setUnsafeChecker };
});
