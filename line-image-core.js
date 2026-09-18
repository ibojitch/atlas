/* LINE画像処理の純粋計算。CanvasやProjectモデルに依存しません。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineImageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_EDIT = Object.freeze({ threshold: 1, margin: 10, upscale: true, scale: 1, offsetX: 0, offsetY: 0 });
  function finite(value, label) { if (!Number.isFinite(value)) throw new Error(`${label}が不正です。`); return value; }
  function validateEdit(value = {}) {
    const edit = { ...DEFAULT_EDIT, ...value };
    if (!Number.isSafeInteger(edit.threshold) || edit.threshold < 0 || edit.threshold > 254) throw new Error('alphaしきい値は0〜254の整数にしてください。');
    if (!Number.isSafeInteger(edit.margin) || edit.margin < 0 || edit.margin > 40) throw new Error('余白は0〜40pxの整数にしてください。');
    if (typeof edit.upscale !== 'boolean') throw new Error('拡大設定が不正です。');
    if (!Number.isFinite(edit.scale) || edit.scale < .1 || edit.scale > 4) throw new Error('倍率は0.1〜4にしてください。');
    for (const key of ['offsetX', 'offsetY']) if (!Number.isSafeInteger(edit[key]) || Math.abs(edit[key]) > 1000) throw new Error('offsetは±1000pxの整数にしてください。');
    return edit;
  }
  function alphaBounds(data, width, height, threshold = 1) {
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1 || data.length !== width * height * 4) throw new Error('画素データのサイズが一致しません。');
    if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 254) throw new Error('alphaしきい値が不正です。');
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0, i = 3; y < height; y++) for (let x = 0; x < width; x++, i += 4) if (data[i] > threshold) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }
  const evenCeil = value => Math.max(2, Math.ceil(value / 2) * 2);
  function stickerPlan(bounds, rawEdit = {}) {
    if (!bounds || !Number.isFinite(bounds.width) || bounds.width <= 0 || !Number.isFinite(bounds.height) || bounds.height <= 0) throw new Error('有効画素領域がありません。');
    const edit = validateEdit(rawEdit), maxW = 370, maxH = 320;
    const innerW = Math.max(1, maxW - edit.margin * 2), innerH = Math.max(1, maxH - edit.margin * 2);
    let fit = Math.min(innerW / bounds.width, innerH / bounds.height);
    if (!edit.upscale) fit = Math.min(1, fit);
    const scale = fit * edit.scale, drawWidth = bounds.width * scale, drawHeight = bounds.height * scale;
    if (drawWidth > maxW || drawHeight > maxH) throw new Error('倍率が大きすぎて370×320pxを超えます。');
    const width = evenCeil(Math.min(maxW, drawWidth + edit.margin * 2));
    const height = evenCeil(Math.min(maxH, drawHeight + edit.margin * 2));
    return { width, height, scale, bounds: { ...bounds }, draw: { x: (width - drawWidth) / 2 + edit.offsetX, y: (height - drawHeight) / 2 + edit.offsetY, width: drawWidth, height: drawHeight } };
  }
  function fixedPlan(bounds, width, height, rawEdit = {}) {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('有効画素領域がありません。');
    const edit = validateEdit({ margin: 0, ...rawEdit });
    let fit = Math.min(width / bounds.width, height / bounds.height);
    if (!edit.upscale) fit = Math.min(1, fit);
    const scale = fit * edit.scale, drawWidth = bounds.width * scale, drawHeight = bounds.height * scale;
    if (drawWidth > width || drawHeight > height) throw new Error('倍率が大きすぎて出力範囲を超えます。');
    return { width, height, scale, bounds: { ...bounds }, draw: { x: (width - drawWidth) / 2 + edit.offsetX, y: (height - drawHeight) / 2 + edit.offsetY, width: drawWidth, height: drawHeight } };
  }
  function parsePng(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.length < 24 || [137,80,78,71,13,10,26,10].some((v,i) => u[i] !== v)) throw new Error('PNG signatureが不正です。');
    const view = new DataView(u.buffer, u.byteOffset, u.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return { DEFAULT_EDIT, validateEdit, alphaBounds, evenCeil, stickerPlan, fixedPlan, parsePng };
});
