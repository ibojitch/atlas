/* UI 非依存の計算。通常の script と Node の両方で利用できます。 */
(function (root) {
  'use strict';
  const DEFAULTS = Object.freeze({ cellWidth: 128, cellHeight: 128, padding: 8,
    columns: 4, threshold: 1, margin: 0, scaleMode: 'individual',
    alignment: 'center', smoothing: 'smooth', pot: false, upscale: true });
  const LIMITS = Object.freeze({ maxSide: 8192, maxPixels: 33554432,
    maxSourcePixels: 33554432, maxTotalSourcePixels: 100663296, maxImages: 500 });
  const ALIGNMENTS = ['top-left', 'top-center', 'top-right', 'center-left',
    'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];

  /** @param {object} s @returns {string[]} */
  function validateSettings(s) {
    const errors = [];
    for (const [key, label] of [['cellWidth', 'セル幅'], ['cellHeight', 'セル高さ'], ['columns', '列数']]) {
      if (!Number.isSafeInteger(s[key]) || s[key] <= 0) errors.push(`${label}は正の整数にしてください。`);
    }
    for (const [key, label] of [['padding', 'セル内余白'], ['margin', 'トリム追加余白']]) {
      if (!Number.isSafeInteger(s[key]) || s[key] < 0) errors.push(`${label}は0以上の整数にしてください。`);
    }
    if (s.padding * 2 >= s.cellWidth || s.padding * 2 >= s.cellHeight) errors.push('セル内余白が大きすぎます。描画領域を1px以上確保してください。');
    if (!Number.isInteger(s.threshold) || s.threshold < 0 || s.threshold > 255) errors.push('alphaしきい値は0〜255の整数にしてください。');
    if (!['individual', 'uniform'].includes(s.scaleMode)) errors.push('スケーリング方式が不正です。');
    if (!ALIGNMENTS.includes(s.alignment)) errors.push('配置位置が不正です。');
    if (!['smooth', 'pixel'].includes(s.smoothing)) errors.push('補間方式が不正です。');
    if (typeof s.pot !== 'boolean' || typeof s.upscale !== 'boolean') errors.push('オプションの値が不正です。');
    if (s.margin > LIMITS.maxSide) errors.push(`トリム追加余白は${LIMITS.maxSide}px以下にしてください。`);
    return errors;
  }

  function restoreSettings(value) {
    if (!value || typeof value !== 'object') return { ...DEFAULTS };
    const s = { ...DEFAULTS };
    // 各保存値を個別に検査し、最後に相互制約を検査する。
    for (const key of Object.keys(DEFAULTS)) {
      const v = value[key];
      if (['cellWidth', 'cellHeight', 'columns'].includes(key)) {
        if (Number.isSafeInteger(v) && v > 0) s[key] = v;
      } else if (['padding', 'margin'].includes(key)) {
        if (Number.isSafeInteger(v) && v >= 0 && (key !== 'margin' || v <= LIMITS.maxSide)) s[key] = v;
      } else {
        const candidate = { ...DEFAULTS, [key]: v };
        if (validateSettings(candidate).length === 0) s[key] = v;
      }
    }
    return validateSettings(s).length ? { ...DEFAULTS } : s;
  }

  /** 各alpha値の外接矩形だけ保持。しきい値変更時の画素再走査を不要にする。 */
  function analyzeAlpha(data, width, height) {
    if (data.length !== width * height * 4) throw new Error('画素データのサイズが一致しません。');
    const bins = Array.from({ length: 256 }, () => ({ minX: width, minY: height, maxX: -1, maxY: -1 }));
    let opaque = true;
    for (let y = 0, offset = 3; y < height; y++) {
      for (let x = 0; x < width; x++, offset += 4) {
        const a = data[offset], b = bins[a];
        if (a !== 255) opaque = false;
        b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
        b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      }
    }
    return { bins, opaque, width, height };
  }

  /** 有効画素は厳密に alpha > threshold。nullは有効画素なし。 */
  function alphaBounds(analysis, threshold) {
    let minX = analysis.width, minY = analysis.height, maxX = -1, maxY = -1;
    for (let a = threshold + 1; a <= 255; a++) {
      const b = analysis.bins[a];
      if (b.maxX < 0) continue;
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function addMargin(bounds, margin) {
    return { x: bounds.x - margin, y: bounds.y - margin,
      width: bounds.width + margin * 2, height: bounds.height + margin * 2 };
  }
  function fitScale(width, height, s) {
    const scale = Math.min((s.cellWidth - 2 * s.padding) / width, (s.cellHeight - 2 * s.padding) / height);
    return s.upscale ? scale : Math.min(1, scale);
  }
  function uniformScale(items, s) {
    return items.length ? Math.min(...items.map(item => fitScale(item.trim.width, item.trim.height, s))) : 1;
  }
  function align(width, height, s) {
    const horizontal = s.alignment.endsWith('left') ? 0 : s.alignment.endsWith('right') ? 1 : 0.5;
    const vertical = s.alignment.startsWith('top') ? 0 : s.alignment.startsWith('bottom') ? 1 : 0.5;
    return { x: s.padding + (s.cellWidth - 2 * s.padding - width) * horizontal,
      y: s.padding + (s.cellHeight - 2 * s.padding - height) * vertical, width, height };
  }
  function nextPowerOfTwo(n) { return 2 ** Math.ceil(Math.log2(Math.max(1, n))); }
  function layout(count, s) {
    const errors = validateSettings(s);
    if (errors.length) throw new Error(errors.join(' '));
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('有効な画像がありません。画像を追加してください。');
    if (count > LIMITS.maxImages) throw new Error(`画像は${LIMITS.maxImages}枚までです。`);
    const rows = Math.ceil(count / s.columns);
    const contentWidth = s.columns * s.cellWidth, contentHeight = rows * s.cellHeight;
    const width = s.pot ? nextPowerOfTwo(contentWidth) : contentWidth;
    const height = s.pot ? nextPowerOfTwo(contentHeight) : contentHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxPixels) {
      throw new Error(`Canvas上限を超えます（各辺${LIMITS.maxSide}px・合計32M画素まで）。セルサイズや列数を調整してください。`);
    }
    return { rows, columns: s.columns, width, height, contentWidth, contentHeight };
  }
  function cellPosition(index, s) { return { x: (index % s.columns) * s.cellWidth, y: Math.floor(index / s.columns) * s.cellHeight }; }

  /** この描画計画をCanvasとJSONの唯一の座標ソースとする。 */
  function makePlan(items, s) {
    const size = layout(items.length, s);
    const sharedScale = uniformScale(items, s);
    const sprites = items.map((item, index) => {
      const scale = s.scaleMode === 'uniform' ? sharedScale : fitScale(item.trim.width, item.trim.height, s);
      const draw = align(item.trim.width * scale, item.trim.height * scale, s);
      const contentDraw = { x: draw.x + (item.bounds.x - item.trim.x) * scale,
        y: draw.y + (item.bounds.y - item.trim.y) * scale,
        width: item.bounds.width * scale, height: item.bounds.height * scale };
      return { index, name: item.name, source: item.source, ...cellPosition(index, s),
        width: s.cellWidth, height: s.cellHeight, sourceWidth: item.width, sourceHeight: item.height,
        trim: { ...item.trim }, bounds: { ...item.bounds }, draw, contentDraw, scale };
    });
    return { ...size, sprites };
  }
  function metadata(plan, s, image) {
    return { meta: { version: 1, image, cellWidth: s.cellWidth, cellHeight: s.cellHeight,
      columns: plan.columns, rows: plan.rows, atlasWidth: plan.width, atlasHeight: plan.height,
      contentWidth: plan.contentWidth, contentHeight: plan.contentHeight,
      scaleMode: s.scaleMode, alignment: s.alignment, padding: s.padding,
      alphaThreshold: s.threshold, trimMargin: s.margin, smoothing: s.smoothing,
      powerOfTwo: s.pot, upscale: s.upscale }, sprites: plan.sprites };
  }
  function uniqueName(proposed, used) {
    const base = String(proposed).trim() || 'sprite';
    let name = base, suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    return name;
  }
  function localDate(date = new Date()) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }
  function nextSequence(record, date) {
    return record && record.date === date && Number.isSafeInteger(record.last) && record.last >= 0 && record.last < 999999999 ? record.last + 1 : 0;
  }
  function basename(date, number) { return `${date}_${String(number).padStart(4, '0')}`; }
  const api = { DEFAULTS, LIMITS, ALIGNMENTS, validateSettings, restoreSettings, analyzeAlpha, alphaBounds,
    addMargin, fitScale, uniformScale, align, nextPowerOfTwo, layout, cellPosition, makePlan, metadata,
    uniqueName, localDate, nextSequence, basename };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AtlasCore = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
