/* LINE Stamp Phase 1: pure project model and validation. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineStampCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({
    maxFileBytes: 1024 * 1024,
    mainImage: Object.freeze({ width: 240, height: 240 }),
    tabImage: Object.freeze({ width: 96, height: 74, format: 'PNG' }),
    static: Object.freeze({
      counts: Object.freeze([8, 16, 24, 32, 40]),
      mainFormat: 'PNG', stickerFormat: 'PNG', stickerMaxWidth: 370, stickerMaxHeight: 320
    }),
    animated: Object.freeze({
      counts: Object.freeze([8, 16, 24]),
      mainFormat: 'APNG', stickerFormat: 'APNG', stickerMaxWidth: 320, stickerMaxHeight: 270,
      framesMin: 5, framesMax: 20, loopsMin: 1, loopsMax: 4,
      totalDurationMax: 4, allowedDurations: Object.freeze([1, 2, 3, 4])
    })
  });
  function constraints(type) {
    if (type !== 'static' && type !== 'animated') throw new Error('LINE Project typeはstaticまたはanimatedです。');
    return LIMITS[type];
  }
  function createProject(type = 'static', targetStickerCount) {
    const rule = constraints(type), count = targetStickerCount ?? rule.counts[0];
    if (!rule.counts.includes(count)) throw new Error(`${type}では${count}個を選択できません。`);
    return { format: 'line-stamp-project', version: 1, type, targetStickerCount: count, mainImage: null, tabImage: null, stickers: [] };
  }
  function validateProject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LINE ProjectがObjectではありません。');
    if (value.format !== 'line-stamp-project' || value.version !== 1) throw new Error('未対応のLINE Project形式またはversionです。');
    const rule = constraints(value.type);
    if (!Number.isSafeInteger(value.targetStickerCount) || !rule.counts.includes(value.targetStickerCount)) throw new Error('スタンプ予定数がtypeの制約と一致しません。');
    if (value.mainImage !== null || value.tabImage !== null) throw new Error('Phase 1ではMain/Tab実画像を読み込めません。');
    if (!Array.isArray(value.stickers) || value.stickers.length !== 0) throw new Error('Phase 1ではSticker実画像を読み込めません。');
    return createProject(value.type, value.targetStickerCount);
  }
  function changeType(project, type) {
    const rule = constraints(type);
    return createProject(type, rule.counts.includes(project.targetStickerCount) ? project.targetStickerCount : rule.counts[0]);
  }
  return { LIMITS, constraints, createProject, validateProject, changeType };
});
