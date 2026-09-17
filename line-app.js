/* LINE Stamp workspace Phase 1 UI. No image processing or APNG encoder. */
(function () {
  'use strict';
  const C = window.LineStampCore, W = window.WorkspaceShell, $ = id => document.getElementById(id);
  let project = C.createProject(), projectUrl = null, saveLinkUsed = false, busy = false;
  function notice(text, kind = 'info') { $('lineNotice').textContent = text; $('lineNotice').className = `notice ${kind}`; $('lineNotice').hidden = !text; }
  function invalidateSave(text = '未保存の変更があります。Projectをもう一度用意してください。') {
    if (projectUrl) URL.revokeObjectURL(projectUrl);
    projectUrl = null; saveLinkUsed = false; $('lineSaveProject').hidden = true; $('lineSaveProject').removeAttribute('href');
    $('lineConfirmSave').hidden = true; $('lineConfirmSave').disabled = true; $('lineProjectStatus').textContent = text;
  }
  function markChanged() { invalidateSave(); W.setDirty('line', true); }
  function render() {
    const rule = C.constraints(project.type), animated = project.type === 'animated';
    $('lineType').value = project.type;
    $('lineStickerCount').replaceChildren(...rule.counts.map(count => {
      const option = document.createElement('option'); option.value = count; option.textContent = `${count}個`; option.selected = count === project.targetStickerCount; return option;
    }));
    $('lineMainSpec').textContent = `240 × 240 px · ${rule.mainFormat} · 1MB以下`;
    $('lineStickerSpec').textContent = `最大 ${rule.stickerMaxWidth} × ${rule.stickerMaxHeight} px · ${rule.stickerFormat} · 1個1MB以下`;
    $('lineAnimationSpec').hidden = !animated;
    $('lineApngStatus').hidden = !animated;
    $('lineSlots').replaceChildren(...Array.from({ length: project.targetStickerCount }, (_, index) => {
      const slot = document.createElement('div'); slot.className = 'line-slot'; slot.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><strong>Sticker</strong><small>Phase 1 · 画像未設定</small>`; return slot;
    }));
    $('lineProjectSummary').textContent = `${animated ? 'Animated' : 'Static'} · ${project.targetStickerCount} stickers\nMain: 未設定 / Tab: 未設定\nSticker: 0 / ${project.targetStickerCount}`;
  }
  function setBusy(value) { busy = value; for (const id of ['lineNewProject','linePrepareProject','lineLoadProject','lineType','lineStickerCount']) $(id).disabled = busy; }
  function prepareProject() {
    try {
      const snapshot = C.validateProject(project), blob = new Blob([JSON.stringify(snapshot, null, 2) + '\n'], { type: 'application/json' });
      if (projectUrl) URL.revokeObjectURL(projectUrl); projectUrl = URL.createObjectURL(blob); saveLinkUsed = false;
      $('lineSaveProject').href = projectUrl; $('lineSaveProject').download = `line-stamp-${project.type}-${project.targetStickerCount}.line-project.json`; $('lineSaveProject').hidden = false;
      $('lineConfirmSave').hidden = false; $('lineConfirmSave').disabled = true;
      $('lineProjectStatus').textContent = 'Projectを用意済み。リンクを使用し、保存完了を確認してください。';
      notice('LINE Projectデータを用意しました。この操作だけでは保存済みになりません。');
    } catch (error) { notice(`Projectを用意できません：${error.message}`, 'error'); }
  }
  async function loadProject(file) {
    if (!file || busy || !W.confirmDestructive('line')) return;
    setBusy(true);
    try {
      let parsed; try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Project JSONを解析できません。'); }
      const validated = C.validateProject(parsed);
      project = validated; invalidateSave('ProjectをLOADしました。'); render(); W.setDirty('line', false);
      notice(`${file.name}: ${project.type} / ${project.targetStickerCount}個のLINE Projectを読み込みました。`);
    } catch (error) { notice(`Projectを読み込めません：${error.message} 現在の編集内容は維持しました。`, 'error'); }
    finally { setBusy(false); }
  }
  $('lineType').addEventListener('change', event => { project = C.changeType(project, event.target.value); markChanged(); render(); });
  $('lineStickerCount').addEventListener('change', event => { project.targetStickerCount = Number(event.target.value); markChanged(); render(); });
  $('lineNewProject').addEventListener('click', () => { if (!W.confirmDestructive('line')) return; project = C.createProject(); invalidateSave('新しいLINE Projectです。'); render(); W.setDirty('line', false); notice('新しいLINE Projectを開始しました。'); });
  $('linePrepareProject').addEventListener('click', prepareProject);
  $('lineSaveProject').addEventListener('click', () => { saveLinkUsed = true; $('lineConfirmSave').disabled = false; });
  $('lineConfirmSave').addEventListener('click', () => { if (!saveLinkUsed) return; W.setDirty('line', false); $('lineProjectStatus').textContent = '保存完了を確認しました。'; $('lineConfirmSave').disabled = true; notice('LINE Projectの保存完了を記録しました。'); });
  $('lineLoadProject').addEventListener('click', () => $('lineProjectInput').click());
  $('lineProjectInput').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) loadProject(file); });
  W.setUnsafeChecker('line', () => busy);
  window.addEventListener('pagehide', event => { if (!event.persisted && projectUrl) { URL.revokeObjectURL(projectUrl); projectUrl = null; } });
  render();
})();
