/* ブラウザ標準APIのみ。file://で動くようES Modulesは使用しない。 */
(function () {
  'use strict';
  const C = window.AtlasCore, R = window.AtlasRenderer;
  const $ = id => document.getElementById(id);
  const form = $('settingsForm');
  const SETTINGS_KEY = 'sprite-atlas.settings.v1', SEQUENCE_KEY = 'sprite-atlas.sequence.v1';
  // imageは描画用ソース。将来のレイヤー合成もこの境界で用意し、配置計算には持ち込まない。
  /** @typedef {{id:number,source:string,name:string,tags:string[],width:number,height:number,image:ImageBitmap|null,url:string|null,analysis:object|null,thumb:string,error:string,trim:object|null,bounds:object|null,offsetX:number,offsetY:number,groupId:string,animationOrder:number,durationFrames:number,extracted?:boolean,anchor?:object|null,tagError?:string}} SourceItem */
  const state = { settings: { ...C.DEFAULTS }, items: [], nextId: 1, busy: false, saving: false,
    selectedItemId: null, groups: new Map(), plan: null, validItems: [], pending: null, totalPixels: 0, sequence: null,
    timer: null, queue: Promise.resolve(), storageWarning: false };
  const playback = { raf: null, playing: false, start: 0, groupId: '', animation: null, frameIndex: -1 };
  let gridSource = null, projectUrl = null;

  function message(text, kind = 'info') {
    $('notice').textContent = text; $('notice').className = `notice ${kind}`; $('notice').hidden = !text;
  }
  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)); }
    catch { state.storageWarning = true; return null; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { state.storageWarning = true; message('ブラウザの設定保存が利用できません。この画面内では設定・連番を保持しますが、再起動後は保存済みファイル名をご確認ください。', 'warning'); }
  }
  function populateSettings() {
    for (const [key, value] of Object.entries(state.settings)) {
      const input = form.elements.namedItem(key);
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
    }
  }
  function settingsFromForm() {
    const result = {};
    for (const [key, defaultValue] of Object.entries(C.DEFAULTS)) {
      const input = form.elements.namedItem(key);
      result[key] = typeof defaultValue === 'boolean' ? input.checked : typeof defaultValue === 'number' ? (input.value.trim() === '' ? NaN : Number(input.value)) : input.value;
      input.removeAttribute('aria-invalid');
      if (!input.validity.valid) input.setAttribute('aria-invalid', 'true');
    }
    return result;
  }
  function settingsChanged() {
    state.settings = settingsFromForm();
    if (!C.validateSettings(state.settings).length) writeStorage(SETTINGS_KEY, state.settings);
    state.plan = null; updateButtons();
    clearTimeout(state.timer); state.timer = setTimeout(rebuild, 120);
  }
  function updateButtons() {
    $('exportButton').disabled = !state.plan || state.busy || state.saving || !!state.pending;
    $('clearImages').disabled = !state.items.length || state.busy || state.saving;
    $('pickFiles').disabled = state.saving;
    $('splitFiles').disabled = state.saving || state.busy;
    $('pickGrid').disabled = state.saving || state.busy;
    $('addGrid').disabled = !gridSource || state.saving || state.busy;
    $('prepareProject').disabled = !state.items.length || state.saving || state.busy;
    $('loadProject').disabled = state.saving || state.busy;
    const transformDisabled = !selectedItem() || state.busy || state.saving;
    $('flipHorizontalCopy').disabled = transformDisabled;
    $('flipVerticalCopy').disabled = transformDisabled;
    $('exportButton').textContent = state.saving ? '書き出し中…' : 'PNG + JSON を用意';
  }
  function currentSequence(date) {
    // 別タブが保存した連番を読み直す。storage不可の場合はメモリの連番を使う。
    const disk = readStorage(SEQUENCE_KEY);
    return Math.max(C.nextSequence(disk, date), C.nextSequence(state.sequence, date));
  }
  function updateFilename() {
    const date = C.localDate();
    $('nextFilename').textContent = `${C.basename(date, currentSequence(date))}.png / .json`;
  }
  function commitSequence(date, number) {
    const disk = readStorage(SEQUENCE_KEY);
    const last = Math.max(number, disk?.date === date && Number.isSafeInteger(disk.last) ? disk.last : -1,
      state.sequence?.date === date ? state.sequence.last : -1);
    state.sequence = { date, last }; writeStorage(SEQUENCE_KEY, state.sequence); updateFilename();
  }

  function rebuild(refreshList = true) {
    clearTimeout(state.timer);
    state.plan = null;
    $('scaleHelp').textContent = state.settings.scaleMode === 'uniform'
      ? '全画像に共通の倍率を適用。ポーズによる大きさのばらつきを抑えます。アニメーション向け。'
      : '各画像がセル内で最大になるよう個別に拡大・縮小します。アイコンやアイテム向け。';
    const errors = C.validateSettings(state.settings);
    errors.push(...C.validateAnimations(state.items, state.groups));
    for (const item of state.items) {
      try { C.normalizeTags(item.tags); } catch (error) { errors.push(`${item.name}: ${error.message}`); }
      if (item.tagError) errors.push(`${item.name}: ${item.tagError}`);
    }
    state.validItems = [];
    if (!errors.length) {
      for (const item of state.items) {
        if (!item.analysis) continue;
        item.bounds = C.alphaBounds(item.analysis, state.settings.threshold);
        if (item.extracted) item.anchor = C.alphaAnchor(item.analysis, state.settings.threshold);
        item.trim = item.bounds ? C.addMargin(item.bounds, state.settings.margin) : null;
        item.error = item.bounds ? '' : (C.alphaBounds(item.analysis, 0) ? 'しきい値を超える画素がありません。しきい値を下げてください。' : '完全透明画像です。有効な画素がありません。');
        if (item.trim) state.validItems.push(item);
      }
      if (state.validItems.length) {
        try {
          const plan = C.makePlan(state.validItems, state.settings);
          C.buildAnimations(plan.sprites, state.groups);
          R.render($('atlasCanvas'), state.validItems, plan, state.settings);
          state.plan = plan;
        } catch (error) { errors.push(error.message); }
      } else if (state.items.length && !state.busy) errors.push('出力できる画像がありません。画像のエラーやしきい値を確認してください。');
    }
    $('validation').textContent = errors.join('\n'); $('validation').hidden = !errors.length;
    $('canvasWrap').hidden = !state.plan; $('emptyPreview').hidden = !!state.plan;
    if (state.plan) {
      const p = state.plan, excluded = state.items.length - p.sprites.length;
      $('previewStats').textContent = `${p.width} × ${p.height} px  ·  セル ${state.settings.cellWidth} × ${state.settings.cellHeight}  ·  ${p.columns} 列 × ${p.rows} 行  ·  ${p.sprites.length} スプライト${excluded ? `  ·  ${excluded} 枚を除外` : ''}`;
    } else {
      $('atlasCanvas').width = 1; $('atlasCanvas').height = 1;
      $('previewStats').textContent = errors.length ? '設定または画像を確認してください。' : '画像を追加すると、ここに出力サイズが表示されます。';
    }
    if (!state.items.some(i => i.id === state.selectedItemId)) state.selectedItemId = state.items[0]?.id ?? null;
    if (refreshList) renderList(); renderInspector(refreshList); resizePreview(); updateButtons(); updateFilename();
  }
  function resizePreview() {
    if (!state.plan) return;
    const { width, height, contentWidth, contentHeight } = state.plan;
    const viewport = $('previewViewport');
    const zoom = $('zoom').value === 'fit' ? Math.min((viewport.clientWidth - 42) / width, (viewport.clientHeight - 42) / height, 1) : Number($('zoom').value);
    const ratio = Math.max(0.001, zoom), wrap = $('canvasWrap');
    wrap.style.width = `${width * ratio}px`; wrap.style.height = `${height * ratio}px`;
    wrap.classList.toggle('pixel', state.settings.smoothing === 'pixel');
    const grid = $('gridOverlay'); grid.hidden = !$('showGrid').checked;
    grid.style.width = `${contentWidth * ratio}px`; grid.style.height = `${contentHeight * ratio}px`;
    grid.style.backgroundSize = `${state.settings.cellWidth * ratio}px ${state.settings.cellHeight * ratio}px`;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function renderList() {
    const list = $('imageList'), scroll = list.scrollTop, fragment = document.createDocumentFragment();
    const indexes = new Map(state.validItems.map((item, index) => [item.id, index]));
    for (const [position, item] of state.items.entries()) {
      const row = element('div', `image-row${item.error ? ' has-error' : ''}`); row.dataset.id = item.id;
      row.append(element('span', 'image-index', indexes.has(item.id) ? String(indexes.get(item.id)) : '—'));
      const thumbnail = element('div', 'thumbnail checker');
      if (item.thumb) { const img = element('img'); img.src = item.thumb; img.alt = ''; thumbnail.append(img); }
      else thumbnail.textContent = item.error ? '!' : '…';
      row.append(thumbnail);
      row.classList.toggle('selected', item.id === state.selectedItemId);
      row.tabIndex = 0; row.setAttribute('aria-label', item.name); row.setAttribute('aria-current', String(item.id === state.selectedItemId));
      const detail = element('div', 'image-detail');
      detail.append(element('strong', 'sprite-name', item.name));
      detail.append(element('div', 'animation-summary hint', `Group: ${item.groupId || '未所属'} · Order: ${item.animationOrder} · Duration: ${item.durationFrames}f`));
      const source = element('div', 'source-name', item.source); source.title = item.source; detail.append(source);
      detail.append(element('div', 'dimensions', item.width ? `${item.width} × ${item.height} → ${item.trim ? `${item.trim.width} × ${item.trim.height} px` : '—'}` : 'サイズ未取得'));
      let status = item.error;
      if (!status && item.analysis?.opaque) status = '全面不透明：透明余白の自動トリミングは行われません。';
      if (status) detail.append(element('div', `image-status${item.error ? ' error' : ''}`, status));
      row.append(detail);
      const actions = element('div', 'row-actions');
      for (const [action, label, title, disabled] of [['up', '↑', '前に移動', position === 0], ['down', '↓', '後ろに移動', position === state.items.length - 1], ['delete', '削除', '画像を削除', false]]) {
        const button = element('button', '', label); button.type = 'button'; button.dataset.action = action;
        button.title = title; button.setAttribute('aria-label', `${item.name}：${title}`); button.disabled = disabled || state.busy || state.saving; actions.append(button);
      }
      row.append(actions); fragment.append(row);
    }
    list.replaceChildren(fragment); list.scrollTop = scroll;
    $('imageCount').textContent = state.items.length; $('emptyList').hidden = !!state.items.length;
  }
  function selectedItem() { return state.items.find(i => i.id === state.selectedItemId); }
  function selectItem(id) {
    const focusRow = document.activeElement?.classList.contains('image-row');
    state.selectedItemId = id; renderList(); renderInspector();
    if (focusRow) $('imageList').querySelector(`[data-id="${id}"]`)?.focus();
  }
  function renderInspector(syncFields = true) {
    const item = selectedItem();
    $('inspectorEmpty').hidden = !!item; $('inspectorContent').hidden = !item;
    if (!item) { $('selectedCanvas').width = 1; $('selectedCanvas').height = 1; refreshAnimation(); return; }
    if (syncFields) {
      $('spriteName').value = item.name;
      $('spriteTags').value = item.tags.join(', '); $('spriteTags').setCustomValidity(item.tagError || '');
      for (const key of ['offsetX', 'offsetY']) { $(key).value = item[key]; $(key).setCustomValidity(''); }
      for (const key of ['groupId', 'animationOrder', 'durationFrames']) $(key).value = item[key];
    }
    $('groupFps').disabled = !item.groupId;
    if (syncFields || document.activeElement !== $('groupFps')) $('groupFps').value = item.groupId ? state.groups.get(item.groupId)?.fps ?? 60 : '';
    $('placementHelp').textContent = (item.extracted ? '重心X・下端Y基準' : '9点配置基準') + ' / 補正は出力px';
    $('selectedStatus').textContent = item.error || item.source;
    const index = state.validItems.indexOf(item), sprite = state.plan?.sprites[index];
    R.renderPreview($('selectedCanvas'), $('atlasCanvas'), sprite, state.settings);
    refreshAnimation();
  }
  function cancelPlayback() { if (playback.raf !== null) cancelAnimationFrame(playback.raf); playback.raf = null; }
  function drawAnimationFrame(elapsedMs) {
    const frame = C.animationFrameAt(playback.animation, elapsedMs, $('loopAnimation').checked);
    if (!frame) return;
    if (frame.index !== playback.frameIndex) {
      playback.frameIndex = frame.index;
      const sprite = state.plan.sprites[frame.sprite];
      R.renderPreview($('animationCanvas'), $('atlasCanvas'), sprite, state.settings);
      $('animationCanvas').dataset.spriteIndex = sprite.index;
      $('animationFrameInfo').textContent = `フレーム ${frame.index + 1} / ${playback.animation.frames.length} · ${sprite.name} · Order ${sprite.animationOrder} · ${sprite.durationFrames}f`;
    }
    if (frame.done) playback.playing = false;
    $('playAnimation').disabled = playback.playing;
    $('stopAnimation').disabled = !playback.playing;
  }
  function tickAnimation(now) {
    playback.raf = null;
    if (!playback.playing || !playback.animation || !state.plan) return;
    drawAnimationFrame(Math.max(0, now - playback.start));
    if (playback.playing) playback.raf = requestAnimationFrame(tickAnimation);
  }
  function refreshAnimation() {
    cancelPlayback();
    const groupId = selectedItem()?.groupId || '';
    if (groupId !== playback.groupId) playback.playing = false;
    playback.groupId = groupId; playback.frameIndex = -1;
    playback.animation = state.plan && groupId ? C.buildAnimations(state.plan.sprites, state.groups)[groupId] : null;
    $('animationInfo').textContent = playback.animation ? `Group: ${groupId} · ${playback.animation.fps} FPS` : '有効なSpriteをGroupに設定するとプレビューできます。';
    $('playAnimation').disabled = !playback.animation;
    $('stopAnimation').disabled = !playback.playing;
    if (!playback.animation) {
      playback.playing = false; $('stopAnimation').disabled = true;
      R.renderPreview($('animationCanvas'), $('atlasCanvas'), null, state.settings);
      delete $('animationCanvas').dataset.spriteIndex; $('animationFrameInfo').textContent = ''; return;
    }
    playback.start = performance.now(); drawAnimationFrame(0);
    if (playback.playing) playback.raf = requestAnimationFrame(tickAnimation);
  }
  function disposeItem(item) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.image) { item.image.close(); state.totalPixels -= item.width * item.height; }
    item.image = null; item.analysis = null;
  }
  function closeTemporaryItems(items) {
    for (const item of items) { if (item.url) URL.revokeObjectURL(item.url); if (item.image) item.image.close(); item.image = null; }
  }
  function thumbnail(image, width, height) {
    const ratio = Math.min(60 / width, 60 / height, 1), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('thumbnail用Canvasを作成できません。');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/png'); canvas.width = 1; canvas.height = 1; return result;
  }
  async function itemFromPixels(pixels, width, height, values) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; let image;
    try {
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('画像生成用Canvasを作成できません。');
      ctx.putImageData(new ImageData(pixels, width, height), 0, 0); image = await createImageBitmap(canvas);
      const item = { ...values, width, height, image, url: null,
        analysis: C.analyzeAlpha(pixels, width, height), thumb: '', error: '', trim: null, bounds: null };
      item.thumb = thumbnail(image, width, height); return item;
    } catch (error) { if (image) image.close(); throw error; }
    finally { canvas.width = 1; canvas.height = 1; }
  }
  async function copyFlippedItem(item, horizontal) {
    if (!item?.image || state.busy || state.saving) return;
    const pixels = item.width * item.height;
    if (state.items.length >= C.LIMITS.maxImages) { message(`画像の上限${C.LIMITS.maxImages}枚を超えるため複製できません。`, 'error'); return; }
    if (state.totalPixels + pixels > C.LIMITS.maxTotalSourcePixels) { message('複製後の読み込み済み画像合計が96M画素を超えるため追加できません。', 'error'); return; }
    state.busy = true; updateButtons();
    let canvas, copy;
    try {
      canvas = document.createElement('canvas'); canvas.width = item.width; canvas.height = item.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('反転用Canvasを作成できません。');
      ctx.save();
      if (horizontal) { ctx.translate(item.width, 0); ctx.scale(-1, 1); }
      else { ctx.translate(0, item.height); ctx.scale(1, -1); }
      ctx.drawImage(item.image, 0, 0); ctx.restore();
      const imageData = ctx.getImageData(0, 0, item.width, item.height);
      const suffix = horizontal ? '_flipH' : '_flipV';
      copy = {
        id: state.nextId++, source: item.source,
        name: C.uniqueName(`${item.name}${suffix}`, new Set(state.items.map(i => i.name))),
        width: item.width, height: item.height, image: await createImageBitmap(canvas), url: null,
        analysis: C.analyzeAlpha(imageData.data, item.width, item.height), thumb: '', error: '', trim: null, bounds: null,
        tags: [...item.tags], offsetX: item.offsetX, offsetY: item.offsetY, extracted: !!item.extracted, anchor: null, ...C.ANIMATION_DEFAULTS
      };
      copy.thumb = thumbnail(copy.image, copy.width, copy.height);
      state.totalPixels += pixels;
      const position = state.items.indexOf(item); state.items.splice(position + 1, 0, copy); state.selectedItemId = copy.id;
      message(`${item.name} を${horizontal ? '左右' : '上下'}反転して ${copy.name} として複製しました。`);
    } catch (error) {
      if (copy?.image) copy.image.close();
      message(`反転コピーに失敗しました: ${error.message}`, 'error');
    } finally {
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      state.busy = false; rebuild();
    }
  }
  async function decodeItem(file, item) {
    let image, bitmap, scratch;
    try {
      if (!file.size) throw new Error('空のファイルです。');
      item.url = URL.createObjectURL(file); image = new Image(); image.src = item.url;
      await image.decode();
      item.width = image.naturalWidth; item.height = image.naturalHeight;
      const pixels = item.width * item.height;
      if (!pixels || item.width > 16384 || item.height > 16384 || pixels > C.LIMITS.maxSourcePixels) throw new Error('入力画像の上限を超えています（各辺16384px・32M画素まで）。');
      if (state.totalPixels + pixels > C.LIMITS.maxTotalSourcePixels) throw new Error('読み込み済み画像の合計が96M画素を超えます。不要な画像を削除してください。');
      // GIF/APNG等も1フレームを固定し、解析と再描画の内容を一致させる。
      bitmap = await createImageBitmap(image);
      scratch = document.createElement('canvas'); scratch.width = item.width; scratch.height = item.height;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('画像解析用Canvasを作成できません。');
      ctx.drawImage(bitmap, 0, 0);
      item.analysis = C.analyzeAlpha(ctx.getImageData(0, 0, item.width, item.height).data, item.width, item.height);
      item.thumb = thumbnail(bitmap, item.width, item.height);
      item.image = bitmap; state.totalPixels += pixels; item.error = '';
    } catch (error) {
      item.analysis = null; item.error = `読込失敗：${error.message || '画像形式を確認してください。'}`;
      if (bitmap) bitmap.close();
    } finally {
      if (image) image.src = '';
      if (item.url) { URL.revokeObjectURL(item.url); item.url = null; }
      if (scratch) { scratch.width = 1; scratch.height = 1; }
    }
  }
  async function importFiles(files) {
    if (!files.length) return;
    state.busy = true; updateButtons();
    let added = 0, skipped = 0;
    try {
      for (const file of files) {
        if (state.items.length >= C.LIMITS.maxImages) { skipped++; continue; }
        const source = file.name || `clipboard_${state.nextId}.png`;
        const item = { id: state.nextId++, source, name: C.uniqueName(source.replace(/\.[^.]+$/, ''), new Set(state.items.map(i => i.name))),
          tags: [], width: 0, height: 0, image: null, url: null, analysis: null, thumb: '', error: '読み込み中…', trim: null, bounds: null, offsetX: 0, offsetY: 0, ...C.ANIMATION_DEFAULTS };
        state.items.push(item); message(`画像を読み込み中… ${++added} / ${files.length}`);
        await decodeItem(file, item);
        // 大量読込でも定期的に画面と入力処理に制御を返す。
        if (added % 5 === 0 || added === files.length) { rebuild(); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
    } finally { state.busy = false; rebuild(); }
    const errors = state.items.filter(i => i.error).length;
    message(`${added}枚を追加しました。${errors ? ` エラー画像${errors}枚は出力から除外します。` : ''}${skipped ? ` 上限${C.LIMITS.maxImages}枚のため${skipped}枚は追加していません。` : ''}`, errors || skipped ? 'warning' : 'info');
  }
  function enqueueFiles(fileList) {
    if (state.saving) { message('保存処理の完了後に画像を追加してください。', 'warning'); return; }
    const files = Array.from(fileList);
    state.queue = state.queue.then(() => importFiles(files)).catch(error => { state.busy = false; message(`画像読み込み中に問題が発生しました: ${error.message}`, 'error'); updateButtons(); });
  }
  async function importSplit(file, settings) {
    const original = { source: file.name, image: null, url: null }, added = [];
    let scratch;
    state.busy = true; updateButtons();
    try {
      const errors = C.validateSettings(settings); if (errors.length) throw new Error(errors.join(' '));
      const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (signature.join(',') !== '137,80,78,71,13,10,26,10') throw new Error('透過PNGを選択してください。');
      await decodeItem(file, original); if (!original.image) throw new Error(original.error);
      if (original.analysis.opaque) throw new Error('透明部分のあるPNGを選択してください。');
      scratch = document.createElement('canvas'); scratch.width = original.width; scratch.height = original.height;
      const ctx = scratch.getContext('2d'); ctx.drawImage(original.image, 0, 0);
      const data = ctx.getImageData(0, 0, original.width, original.height).data;
      const detection = C.detectIslands(data, original.width, original.height, settings.threshold, settings.minIslandPixels);
      if (state.items.length + detection.islands.length > C.LIMITS.maxImages) throw new Error('画像の上限500枚を超えるため追加できません。');
      const cropPixels = detection.islands.reduce((sum, i) => sum + i.bounds.width * i.bounds.height, 0);
      if (state.totalPixels - original.width * original.height + cropPixels > C.LIMITS.maxTotalSourcePixels) throw new Error('抽出後の合計が96M画素を超えます。');
      const used = new Set(state.items.map(i => i.name));
      for (const [index, island] of detection.islands.entries()) {
        const { width, height } = island.bounds;
        const pixels = C.cropIsland(data, original.width, detection, island);
        const name = C.uniqueName(`${file.name.replace(/\.[^.]+$/, '')}_${String(index + 1).padStart(2, '0')}`, used); used.add(name);
        const item = await itemFromPixels(pixels, width, height, { id: state.nextId++, source: file.name, name,
          tags: [], extracted: true, offsetX: 0, offsetY: 0, anchor: null, ...C.ANIMATION_DEFAULTS });
        state.totalPixels += width * height; added.push(item);
      }
      state.items.push(...added);
      message(`${file.name}: ${added.length}キャラクターを検出・追加しました（ノイズ${detection.discardedCount}島を除外、最小${settings.minIslandPixels}画素）。${added.length ? '' : 'しきい値や島の最小画素数を確認してください。'}`, added.length ? 'info' : 'warning');
    } catch (error) { added.forEach(disposeItem); message(`分割追加できません：${error.message}`, 'error'); }
    finally { disposeItem(original); if (scratch) { scratch.width = 1; scratch.height = 1; } state.busy = false; rebuild(); }
  }
  function gridValues() {
    return C.validateGrid({ imageWidth: gridSource?.width, imageHeight: gridSource?.height,
      cellWidth: Number($('gridCellWidth').value), cellHeight: Number($('gridCellHeight').value),
      columns: Number($('gridColumns').value), rows: Number($('gridRows').value) });
  }
  function occupiedGridCells(grid) {
    const occupied = [];
    for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
      let found = false;
      for (let y = 0; y < grid.cellHeight && !found; y++) for (let x = 0; x < grid.cellWidth; x++) {
        const sourceX = column * grid.cellWidth + x, sourceY = row * grid.cellHeight + y;
        if (gridSource.data[(sourceY * grid.imageWidth + sourceX) * 4 + 3]) { found = true; break; }
      }
      if (found) occupied.push({ row, column });
    }
    return occupied;
  }
  function updateGridSummary() {
    if (!gridSource) { $('gridSummary').textContent = 'Atlas画像を選択すると、推定値とセル数を表示します。'; return; }
    try {
      const grid = gridValues(), occupied = occupiedGridCells(grid);
      $('gridSummary').textContent = `画像 ${grid.imageWidth} × ${grid.imageHeight}px · Cell ${grid.cellWidth} × ${grid.cellHeight}px · ${grid.columns}列 × ${grid.rows}行 · 全${grid.cells}セル · 非透明${occupied.length}セル`;
      $('gridValidation').hidden = true; $('gridValidation').textContent = '';
    } catch (error) {
      $('gridSummary').textContent = `画像 ${gridSource.width} × ${gridSource.height}px`;
      $('gridValidation').textContent = error.message; $('gridValidation').hidden = false;
    }
  }
  async function selectGridSource(file) {
    if (!file || state.busy || state.saving) return;
    state.busy = true; updateButtons(); let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (!bitmap.width || !bitmap.height || bitmap.width > C.LIMITS.maxGridSide || bitmap.height > C.LIMITS.maxGridSide) throw new Error(`Grid Atlasは各辺${C.LIMITS.maxGridSide}px以下にしてください。`);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Grid解析用Canvasを作成できません。');
      ctx.drawImage(bitmap, 0, 0); const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const inferred = C.inferGrid(data, bitmap.width, bitmap.height);
      if (gridSource?.image) gridSource.image.close();
      gridSource = { file, name: file.name || 'atlas.png', image: bitmap, data, width: bitmap.width, height: bitmap.height }; bitmap = null;
      $('gridColumns').value = inferred.columns; $('gridRows').value = inferred.rows;
      $('gridCellWidth').value = inferred.cellWidth; $('gridCellHeight').value = inferred.cellHeight;
      $('gridInference').textContent = inferred.confidence === 'suggested' ? '透明境界からの推定値です。分割前に確認してください。' : 'Gridを一意に推定できませんでした。列・行・Cell寸法を入力してください。';
      updateGridSummary(); message(`${gridSource.name}をGrid分割用に読み込みました。推定値を確認してください。`);
    } catch (error) { if (bitmap) bitmap.close(); message(`Grid Atlasを読み込めません：${error.message}`, 'error'); }
    finally { state.busy = false; updateButtons(); }
  }
  async function importGrid() {
    if (!gridSource || state.busy || state.saving) return;
    state.busy = true; updateButtons(); const added = [];
    try {
      const grid = gridValues(), occupied = occupiedGridCells(grid);
      const addedPixels = occupied.length * grid.cellWidth * grid.cellHeight;
      C.validateAddition(state.items.length, state.totalPixels, occupied.length, addedPixels);
      const used = new Set(state.items.map(item => item.name)), base = gridSource.name.replace(/\.[^.]+$/, '') || 'atlas';
      for (const cell of occupied) {
        const pixels = new Uint8ClampedArray(grid.cellWidth * grid.cellHeight * 4);
        for (let y = 0; y < grid.cellHeight; y++) {
          const start = ((cell.row * grid.cellHeight + y) * grid.imageWidth + cell.column * grid.cellWidth) * 4;
          pixels.set(gridSource.data.subarray(start, start + grid.cellWidth * 4), y * grid.cellWidth * 4);
        }
        const proposed = `${base}_r${String(cell.row + 1).padStart(2, '0')}_c${String(cell.column + 1).padStart(2, '0')}`;
        const name = C.uniqueName(proposed, used); used.add(name);
        added.push(await itemFromPixels(pixels, grid.cellWidth, grid.cellHeight, { id: state.nextId + added.length,
          source: gridSource.name, name, tags: [], offsetX: 0, offsetY: 0, extracted: false, anchor: null, ...C.ANIMATION_DEFAULTS }));
      }
      state.nextId += added.length; state.items.push(...added); state.totalPixels += addedPixels;
      if (added.length) state.selectedItemId = added[0].id;
      message(`${gridSource.name}: 全${grid.cells}セルから非透明${added.length} Spriteを追加しました。${grid.cells - added.length}個の透明セルは除外しました。`, added.length ? 'info' : 'warning');
    } catch (error) { closeTemporaryItems(added); message(`Grid分割追加できません：${error.message}`, 'error'); }
    finally { state.busy = false; rebuild(); }
  }
  function itemPngDataUrl(item) {
    const canvas = document.createElement('canvas'); canvas.width = item.width; canvas.height = item.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Project画像用Canvasを作成できません。');
    ctx.drawImage(item.image, 0, 0); const result = canvas.toDataURL('image/png'); canvas.width = 1; canvas.height = 1; return result;
  }
  function projectSnapshot() {
    return { format: 'sprite-atlas-project', version: 1, settings: { ...state.settings },
      groups: Array.from(state.groups, ([id, group]) => ({ id, fps: group.fps })),
      sprites: state.items.map(item => ({ name: item.name, source: item.source, tags: [...item.tags], width: item.width, height: item.height,
        image: itemPngDataUrl(item), offsetX: item.offsetX, offsetY: item.offsetY, extracted: !!item.extracted,
        groupId: item.groupId, animationOrder: item.animationOrder, durationFrames: item.durationFrames })) };
  }
  async function prepareProjectDownload() {
    if (!state.items.length || state.busy || state.saving) return;
    rebuild(); if ($('validation').hidden === false) { message('Project保存前に入力エラーを修正してください。', 'error'); return; }
    state.saving = true; updateButtons();
    try {
      const project = projectSnapshot(); C.validateProject(project);
      if (projectUrl) URL.revokeObjectURL(projectUrl);
      projectUrl = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' }));
      $('saveProjectLink').href = projectUrl; $('saveProjectLink').download = `sprite-atlas-${C.localDate()}.satlas.json`; $('saveProjectLink').hidden = false;
      message('編集Projectを用意しました。Project保存リンクから保存してください。Runtime連番は変更していません。');
    } catch (error) { message(`Projectを保存できません：${error.message}`, 'error'); }
    finally { state.saving = false; updateButtons(); }
  }
  async function decodeProjectItem(sprite, id) {
    let bitmap;
    try {
      const response = await fetch(sprite.image); if (!response.ok) throw new Error('埋め込み画像を読み取れません。');
      bitmap = await createImageBitmap(await response.blob());
      if (bitmap.width !== sprite.width || bitmap.height !== sprite.height) throw new Error('埋め込み画像の寸法がProject記録と一致しません。');
      const pixels = bitmap.width * bitmap.height;
      if (!pixels || bitmap.width > 16384 || bitmap.height > 16384 || pixels > C.LIMITS.maxSourcePixels) throw new Error('埋め込み画像が入力上限を超えています。');
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Project画像解析用Canvasを作成できません。');
      ctx.drawImage(bitmap, 0, 0); const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { id, source: sprite.source, name: sprite.name, tags: [...sprite.tags], width: bitmap.width, height: bitmap.height,
        image: bitmap, url: null, analysis: C.analyzeAlpha(data, bitmap.width, bitmap.height), thumb: thumbnail(bitmap, bitmap.width, bitmap.height),
        error: '', trim: null, bounds: null, offsetX: sprite.offsetX, offsetY: sprite.offsetY, extracted: sprite.extracted, anchor: null,
        groupId: sprite.groupId, animationOrder: sprite.animationOrder, durationFrames: sprite.durationFrames };
    } catch (error) { if (bitmap) bitmap.close(); throw error; }
  }
  async function loadProjectFile(file) {
    if (!file || state.busy || state.saving) return;
    state.busy = true; updateButtons(); const temporary = [];
    try {
      let parsed; try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Project JSONを解析できません。'); }
      const project = C.validateProject(parsed);
      const declaredPixels = project.sprites.reduce((sum, sprite) => sum + sprite.width * sprite.height, 0);
      if (!Number.isSafeInteger(declaredPixels) || declaredPixels > C.LIMITS.maxTotalSourcePixels) throw new Error('Projectの画像合計が96M画素を超えます。');
      for (let index = 0; index < project.sprites.length; index++) temporary.push(await decodeProjectItem(project.sprites[index], index + 1));
      const actualPixels = temporary.reduce((sum, item) => sum + item.width * item.height, 0);
      if (actualPixels !== declaredPixels) throw new Error('Project画像の合計画素数が一致しません。');
      for (const item of temporary) {
        item.bounds = C.alphaBounds(item.analysis, project.settings.threshold);
        if (!item.bounds) throw new Error(`${item.name}: 現在のalphaしきい値で有効画素がありません。`);
        if (item.extracted) item.anchor = C.alphaAnchor(item.analysis, project.settings.threshold);
        item.trim = C.addMargin(item.bounds, project.settings.margin);
      }
      const plan = C.makePlan(temporary, project.settings); C.buildAnimations(plan.sprites, project.groups);
      cancelPlayback(); playback.playing = false; clearPending();
      state.items.forEach(disposeItem); state.items = temporary.splice(0); state.totalPixels = actualPixels;
      state.settings = { ...project.settings }; state.groups = new Map(project.groups); state.nextId = state.items.length + 1; state.selectedItemId = state.items[0]?.id ?? null;
      populateSettings(); rebuild(); message(`${file.name}: ${state.items.length} Spriteの編集Projectを読み込みました。`);
    } catch (error) { closeTemporaryItems(temporary); message(`Projectを読み込めません：${error.message} 現在の編集内容は維持しました。`, 'error'); }
    finally { state.busy = false; rebuild(); }
  }
  function clearPending() {
    if (state.pending) { URL.revokeObjectURL(state.pending.pngUrl); URL.revokeObjectURL(state.pending.jsonUrl); }
    state.pending = null; $('downloadPanel').hidden = true;
    $('downloadPng').removeAttribute('href'); $('downloadJson').removeAttribute('href'); updateButtons();
  }
  function prepareDownloads(png, json, date, number, base) {
    const pngUrl = URL.createObjectURL(png), jsonUrl = URL.createObjectURL(json);
    state.pending = { pngUrl, jsonUrl, date, number, pngClicked: false, jsonClicked: false };
    for (const [id, url, extension] of [['downloadPng', pngUrl, 'png'], ['downloadJson', jsonUrl, 'json']]) {
      $(id).href = url; $(id).download = `${base}.${extension}`;
    }
    $('downloadDescription').textContent = `${base}.png と ${base}.json をそれぞれ保存してください。`;
    $('confirmDownloads').disabled = true; $('downloadPanel').hidden = false;
  }
  function jsonBlob(plan, settings, base, groups) {
    try { return new Blob([JSON.stringify(C.metadata(plan, settings, `${base}.png`, groups), null, 2) + '\n'], { type: 'application/json' }); }
    catch (error) { throw new Error(`JSON生成に失敗しました: ${error.message}`); }
  }
  async function exportAtlas() {
    if (state.busy || state.saving || state.pending) return;
    rebuild(); if (!state.plan) { message('有効な画像と設定を確認してください。', 'error'); return; }
    state.saving = true; updateButtons();
    const settings = { ...state.settings }, plan = state.plan;
    const groups = new Map(Array.from(state.groups, ([id, group]) => [id, { ...group }]));
    try {
      // toBlobは呼び出し時点のCanvasをスナップショットする。
      const png = await R.pngBlob($('atlasCanvas'));
      const date = C.localDate(), number = currentSequence(date);
      const base = C.basename(date, number), json = jsonBlob(plan, settings, base, groups);
      prepareDownloads(png, json, date, number, base); message('PNGとJSONを用意しました。下の2つの保存リンクをご利用ください。');
    } catch (error) {
      message(`書き出しに失敗しました: ${error.message}\n連番は更新していません。設定を確認して再試行してください。`, 'error');
    } finally { state.saving = false; updateButtons(); }
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', settingsChanged);
  $('resetSettings').addEventListener('click', () => { state.settings = { ...C.DEFAULTS }; populateSettings(); settingsChanged(); });
  $('bottomAlign').addEventListener('click', () => { form.elements.alignment.value = 'bottom-center'; settingsChanged(); });
  $('pickFiles').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', event => { enqueueFiles(event.target.files); event.target.value = ''; });
  $('splitFiles').addEventListener('click', () => $('splitInput').click());
  $('splitInput').addEventListener('change', event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || state.saving) return;
    const settings = { ...state.settings };
    state.queue = state.queue.then(() => importSplit(file, settings));
  });
  $('pickGrid').addEventListener('click', () => $('gridInput').click());
  $('gridInput').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) state.queue = state.queue.then(() => selectGridSource(file)); });
  for (const id of ['gridCellWidth', 'gridCellHeight', 'gridColumns', 'gridRows']) $(id).addEventListener('input', updateGridSummary);
  $('addGrid').addEventListener('click', () => { state.queue = state.queue.then(importGrid); });
  $('prepareProject').addEventListener('click', prepareProjectDownload);
  $('loadProject').addEventListener('click', () => $('projectInput').click());
  $('projectInput').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) state.queue = state.queue.then(() => loadProjectFile(file)); });
  let dragDepth = 0;
  window.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth++; $('dropZone').classList.add('dragging'); } });
  window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropZone').classList.remove('dragging'); } });
  window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropZone').classList.remove('dragging'); enqueueFiles(event.dataTransfer.files); });
  window.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.items || []).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); enqueueFiles(files); }
  });
  $('spriteForm').addEventListener('submit', event => event.preventDefault());
  $('groupId').addEventListener('change', event => { event.target.value = selectedItem()?.groupId || ''; });
  $('playAnimation').addEventListener('click', () => { if (!playback.animation) return; playback.playing = true; refreshAnimation(); });
  $('stopAnimation').addEventListener('click', () => { playback.playing = false; refreshAnimation(); });
  $('loopAnimation').addEventListener('change', refreshAnimation);
  $('flipHorizontalCopy').addEventListener('click', () => copyFlippedItem(selectedItem(), true));
  $('flipVerticalCopy').addEventListener('click', () => copyFlippedItem(selectedItem(), false));
  $('spriteName').addEventListener('change', event => {
    const item = selectedItem(); if (!item) return;
    item.name = C.uniqueName(event.target.value, new Set(state.items.filter(i => i !== item).map(i => i.name))); rebuild();
  });
  $('spriteForm').addEventListener('input', event => {
    const key = event.target.dataset.action, item = selectedItem();
    const id = event.target.id;
    if (item && id === 'spriteTags') {
      try { item.tags = C.normalizeTags(event.target.value); item.tagError = ''; event.target.setCustomValidity(''); }
      catch (error) { item.tagError = error.message; event.target.setCustomValidity(error.message); }
      rebuild(false); return;
    }
    if (item && ['groupId', 'animationOrder', 'durationFrames', 'groupFps'].includes(id)) {
      if (id === 'groupId') {
        item.groupId = event.target.value.trim();
        if (item.groupId && !state.groups.has(item.groupId)) state.groups.set(item.groupId, { id: item.groupId, fps: 60 });
      } else if (id === 'groupFps') {
        if (item.groupId) state.groups.set(item.groupId, { id: item.groupId, fps: event.target.valueAsNumber });
      } else item[id] = event.target.valueAsNumber;
      rebuild(false); renderList(); return;
    }
    if (!item || !['offsetX', 'offsetY'].includes(key)) return;
    const value = event.target.valueAsNumber;
    event.target.setCustomValidity(Number.isSafeInteger(value) ? '' : '整数pxを入力してください。');
    item[key] = value; rebuild(false);
  });
  $('spriteForm').addEventListener('click', event => {
    const button = event.target.closest('button'), item = selectedItem(); if (!button || !item) return;
    const key = button.dataset.action; if (!['offsetX', 'offsetY'].includes(key)) return;
    const value = (Number.isSafeInteger(item[key]) ? item[key] : 0) + Number(button.dataset.delta);
    if (Number.isSafeInteger(value)) item[key] = value; rebuild(); button.focus();
  });
  $('imageList').addEventListener('keydown', event => {
    if (event.target.matches('.image-row') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectItem(Number(event.target.dataset.id)); }
  });
  $('imageList').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) { const row = event.target.closest('.image-row'); if (row) selectItem(Number(row.dataset.id)); return; }
    if (state.busy || state.saving) return;
    const position = state.items.findIndex(i => i.id === Number(button.closest('.image-row').dataset.id));
    if (position < 0) return;
    const action = button.dataset.action, item = state.items[position];
    if (action === 'delete') { disposeItem(item); state.items.splice(position, 1); }
    else { const next = position + (action === 'up' ? -1 : 1); if (next < 0 || next >= state.items.length) return;
      [state.items[position], state.items[next]] = [state.items[next], state.items[position]]; }
    rebuild();
    if (action !== 'delete') $('imageList').querySelector(`[data-id="${item.id}"] button[data-action="${action}"]`)?.focus();
  });
  $('clearImages').addEventListener('click', () => { state.items.forEach(disposeItem); state.items = []; state.groups.clear(); rebuild(); message('入力画像をすべて削除しました。'); });
  $('zoom').addEventListener('change', resizePreview); $('showGrid').addEventListener('change', resizePreview);
  new ResizeObserver(resizePreview).observe($('previewViewport'));
  $('exportButton').addEventListener('click', exportAtlas);
  for (const [id, flag] of [['downloadPng', 'pngClicked'], ['downloadJson', 'jsonClicked']]) {
    $(id).addEventListener('click', () => { if (!state.pending) return; state.pending[flag] = true; $('confirmDownloads').disabled = !(state.pending.pngClicked && state.pending.jsonClicked); });
  }
  $('confirmDownloads').addEventListener('click', () => {
    if (!state.pending?.pngClicked || !state.pending?.jsonClicked) return;
    commitSequence(state.pending.date, state.pending.number); clearPending(); message('保存完了を記録しました。次の書き出しは新しい番号になります。');
  });
  $('cancelDownloads').addEventListener('click', () => { clearPending(); message('書き出しデータを閉じました。連番は進めていません。保存済みの場合は次回の同名ファイルにご注意ください。', 'warning'); });
  window.addEventListener('beforeunload', event => { if (state.pending || state.saving || state.busy) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', event => { cancelPlayback(); playback.playing = false; if (!event.persisted) {
    state.items.forEach(disposeItem); clearPending(); if (gridSource?.image) gridSource.image.close(); gridSource = null;
    if (projectUrl) URL.revokeObjectURL(projectUrl); projectUrl = null;
  } });
  window.addEventListener('focus', updateFilename); window.addEventListener('storage', updateFilename);
  state.settings = C.restoreSettings(readStorage(SETTINGS_KEY)); state.sequence = readStorage(SEQUENCE_KEY);
  populateSettings(); rebuild();
  if (state.storageWarning) message('ブラウザの保存領域を読み込めませんでした。初期値で起動しています。通常ダウンロードは利用できます。', 'warning');
})();
