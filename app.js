/* ブラウザ標準APIのみ。file://で動くようES Modulesは使用しない。 */
(function () {
  'use strict';
  const C = window.AtlasCore, R = window.AtlasRenderer;
  const $ = id => document.getElementById(id);
  const form = $('settingsForm');
  const SETTINGS_KEY = 'sprite-atlas.settings.v1', SEQUENCE_KEY = 'sprite-atlas.sequence.v1';
  // imageは描画用ソース。将来のレイヤー合成もこの境界で用意し、配置計算には持ち込まない。
  /** @typedef {{id:number,source:string,name:string,width:number,height:number,image:ImageBitmap|null,url:string|null,analysis:object|null,thumb:string,error:string,trim:object|null,bounds:object|null,offsetX:number,offsetY:number,extracted?:boolean,anchor?:object|null}} SourceItem */
  const state = { settings: { ...C.DEFAULTS }, items: [], nextId: 1, busy: false, saving: false,
    plan: null, validItems: [], pending: null, totalPixels: 0, sequence: null,
    timer: null, queue: Promise.resolve(), storageWarning: false };

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
    if (refreshList) renderList(); resizePreview(); updateButtons(); updateFilename();
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
      const detail = element('div', 'image-detail'), input = element('input');
      input.value = item.name; input.maxLength = 200; input.dataset.action = 'rename'; input.setAttribute('aria-label', `${item.source} のスプライト名`);
      detail.append(input);
      const offsets = element('div', 'offset-controls');
      for (const axis of ['X', 'Y']) {
        const label = element('label', '', `offset${axis} `), field = element('input');
        field.type = 'number'; field.step = '1'; field.value = item[`offset${axis}`]; field.dataset.action = `offset${axis}`;
        field.setAttribute('aria-label', `${item.name} offset${axis}（px）`); label.append(field); offsets.append(label);
        for (const delta of [-1, 1]) {
          const button = element('button', '', delta < 0 ? '−1' : '+1'); button.type = 'button';
          button.dataset.action = `offset${axis}`; button.dataset.delta = delta;
          button.setAttribute('aria-label', `${item.name} ${axis} ${delta > 0 ? '+' : ''}${delta}px`); offsets.append(button);
        }
      }
      detail.append(element('div', 'hint', item.extracted ? '重心X・下端Y基準 / 補正は出力px' : '9点配置基準 / 補正は出力px')); detail.append(offsets);
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
  function disposeItem(item) {
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.image) { item.image.close(); state.totalPixels -= item.width * item.height; }
    item.image = null; item.analysis = null;
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
      const ratio = Math.min(60 / item.width, 60 / item.height, 1);
      scratch.width = Math.max(1, Math.round(item.width * ratio)); scratch.height = Math.max(1, Math.round(item.height * ratio));
      ctx.drawImage(bitmap, 0, 0, scratch.width, scratch.height); item.thumb = scratch.toDataURL('image/png');
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
          width: 0, height: 0, image: null, url: null, analysis: null, thumb: '', error: '読み込み中…', trim: null, bounds: null, offsetX: 0, offsetY: 0 };
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
        scratch.width = width; scratch.height = height;
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        const name = C.uniqueName(`${file.name.replace(/\.[^.]+$/, '')}_${String(index + 1).padStart(2, '0')}`, used); used.add(name);
        const item = { id: state.nextId++, source: file.name, name, width, height, image: await createImageBitmap(scratch),
          analysis: C.analyzeAlpha(pixels, width, height), extracted: true, offsetX: 0, offsetY: 0, error: '', url: null };
        state.totalPixels += width * height; added.push(item);
        const ratio = Math.min(60 / width, 60 / height, 1);
        scratch.width = Math.max(1, Math.round(width * ratio)); scratch.height = Math.max(1, Math.round(height * ratio));
        ctx.drawImage(item.image, 0, 0, scratch.width, scratch.height); item.thumb = scratch.toDataURL('image/png');
      }
      state.items.push(...added);
      message(`${file.name}: ${added.length}キャラクターを検出・追加しました（ノイズ${detection.discardedCount}島を除外、最小${settings.minIslandPixels}画素）。${added.length ? '' : 'しきい値や島の最小画素数を確認してください。'}`, added.length ? 'info' : 'warning');
    } catch (error) { added.forEach(disposeItem); message(`分割追加できません：${error.message}`, 'error'); }
    finally { disposeItem(original); if (scratch) { scratch.width = 1; scratch.height = 1; } state.busy = false; rebuild(); }
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
  function jsonBlob(plan, settings, base) {
    try { return new Blob([JSON.stringify(C.metadata(plan, settings, `${base}.png`), null, 2) + '\n'], { type: 'application/json' }); }
    catch (error) { throw new Error(`JSON生成に失敗しました: ${error.message}`); }
  }
  async function exportAtlas() {
    if (state.busy || state.saving || state.pending) return;
    rebuild(); if (!state.plan) { message('有効な画像と設定を確認してください。', 'error'); return; }
    state.saving = true; updateButtons();
    const settings = { ...state.settings }, plan = state.plan;
    try {
      // toBlobは呼び出し時点のCanvasをスナップショットする。
      const png = await R.pngBlob($('atlasCanvas'));
      const date = C.localDate(), number = currentSequence(date);
      const base = C.basename(date, number), json = jsonBlob(plan, settings, base);
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
  let dragDepth = 0;
  window.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth++; $('dropZone').classList.add('dragging'); } });
  window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropZone').classList.remove('dragging'); } });
  window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropZone').classList.remove('dragging'); enqueueFiles(event.dataTransfer.files); });
  window.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.items || []).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); enqueueFiles(files); }
  });
  $('imageList').addEventListener('change', event => {
    if (event.target.dataset.action !== 'rename') return;
    const item = state.items.find(i => i.id === Number(event.target.closest('.image-row').dataset.id));
    item.name = C.uniqueName(event.target.value, new Set(state.items.filter(i => i !== item).map(i => i.name)));
    rebuild();
  });
  $('imageList').addEventListener('input', event => {
    const key = event.target.dataset.action;
    if (!['offsetX', 'offsetY'].includes(key)) return;
    const value = event.target.valueAsNumber;
    event.target.setCustomValidity(Number.isSafeInteger(value) ? '' : '整数pxを入力してください。');
    const item = state.items.find(i => i.id === Number(event.target.closest('.image-row').dataset.id));
    item[key] = value; rebuild(false);
  });
  $('imageList').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || state.busy || state.saving) return;
    const position = state.items.findIndex(i => i.id === Number(button.closest('.image-row').dataset.id));
    if (position < 0) return;
    const action = button.dataset.action, item = state.items[position];
    if (['offsetX', 'offsetY'].includes(action)) { const value = (Number.isSafeInteger(item[action]) ? item[action] : 0) + Number(button.dataset.delta); if (Number.isSafeInteger(value)) item[action] = value; }
    else if (action === 'delete') { disposeItem(item); state.items.splice(position, 1); }
    else { const next = position + (action === 'up' ? -1 : 1); if (next < 0 || next >= state.items.length) return;
      [state.items[position], state.items[next]] = [state.items[next], state.items[position]]; }
    rebuild();
    if (action !== 'delete') $('imageList').querySelector(`[data-id="${item.id}"] button[data-action="${action}"]`)?.focus();
  });
  $('clearImages').addEventListener('click', () => { state.items.forEach(disposeItem); state.items = []; rebuild(); message('入力画像をすべて削除しました。'); });
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
  window.addEventListener('pagehide', event => { if (!event.persisted) { state.items.forEach(disposeItem); clearPending(); } });
  window.addEventListener('focus', updateFilename); window.addEventListener('storage', updateFilename);
  state.settings = C.restoreSettings(readStorage(SETTINGS_KEY)); state.sequence = readStorage(SEQUENCE_KEY);
  populateSettings(); rebuild();
  if (state.storageWarning) message('ブラウザの保存領域を読み込めませんでした。初期値で起動しています。通常ダウンロードは利用できます。', 'warning');
})();
