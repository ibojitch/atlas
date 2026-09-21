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
    if (!bounds || !Number.isFinite(bounds.width) || bounds.width <= 0 || !Number.isFinite(bounds.height) || bounds.height <= 0) throw new Error('現在のalphaしきい値では有効な画素がありません。しきい値を下げてください。');
    const edit = validateEdit(rawEdit), maxW = 370, maxH = 320;
    const innerW = Math.max(1, maxW - edit.margin * 2), innerH = Math.max(1, maxH - edit.margin * 2);
    let fit = Math.min(innerW / bounds.width, innerH / bounds.height);
    if (!edit.upscale) fit = Math.min(1, fit);
    const scale = fit * edit.scale, drawWidth = bounds.width * scale, drawHeight = bounds.height * scale;
    if (drawWidth + edit.margin * 2 > maxW || drawHeight + edit.margin * 2 > maxH) throw new Error('画像が370 × 320pxの描画範囲を超えています。倍率または余白を小さくしてください。');
    const width = evenCeil(drawWidth + edit.margin * 2), height = evenCeil(drawHeight + edit.margin * 2);
    const draw = { x: (width - drawWidth) / 2 + edit.offsetX, y: (height - drawHeight) / 2 + edit.offsetY, width: drawWidth, height: drawHeight };
    if (draw.x < -1e-7 || draw.y < -1e-7 || draw.x + draw.width > width + 1e-7 || draw.y + draw.height > height + 1e-7) throw new Error('画像が370 × 320pxの描画範囲を超えています。倍率または位置を調整してください。');
    return { width, height, scale, bounds: { ...bounds }, draw };
  }
  function fixedPlan(bounds, width, height, rawEdit = {}, label = '画像') {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) throw new Error('現在のalphaしきい値では有効な画素がありません。しきい値を下げてください。');
    const edit = validateEdit({ margin: 0, ...rawEdit });
    let fit = Math.min(width / bounds.width, height / bounds.height);
    if (!edit.upscale) fit = Math.min(1, fit);
    const scale = fit * edit.scale, drawWidth = bounds.width * scale, drawHeight = bounds.height * scale;
    const draw = { x: (width - drawWidth) / 2 + edit.offsetX, y: (height - drawHeight) / 2 + edit.offsetY, width: drawWidth, height: drawHeight };
    if (draw.x < -1e-7 || draw.y < -1e-7 || draw.x + draw.width > width + 1e-7 || draw.y + draw.height > height + 1e-7) throw new Error(`${label}の描画範囲${width} × ${height}pxを超えています。倍率または位置を調整してください。`);
    return { width, height, scale, bounds: { ...bounds }, draw };
  }
  function parsePng(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.length < 24 || [137,80,78,71,13,10,26,10].some((v,i) => u[i] !== v)) throw new Error('PNG signatureが不正です。');
    const view = new DataView(u.buffer, u.byteOffset, u.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return { DEFAULT_EDIT, validateEdit, alphaBounds, evenCeil, stickerPlan, fixedPlan, parsePng };
});
