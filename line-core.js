/* LINE Stamp Phase 1: pure project model and validation. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineStampCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({
    maxFileBytes: 1024 * 1024,
    common: Object.freeze({
      maxFileBytes: 1024 * 1024, maxZipBytes: 60 * 1024 * 1024,
      colorMode: 'RGB', transparentBackground: true
    }),
    mainImage: Object.freeze({ width: 240, height: 240 }),
    tabImage: Object.freeze({ width: 96, height: 74, format: 'PNG' }),
    static: Object.freeze({
      counts: Object.freeze([8, 16, 24, 32, 40]),
      mainFormat: 'PNG', stickerFormat: 'PNG', stickerMaxWidth: 370, stickerMaxHeight: 320,
      sticker: Object.freeze({
        format: 'PNG', maxWidth: 370, maxHeight: 320, dimensionMultiple: 2,
        minDpi: 72, recommendedOuterMarginPx: 10
      })
    }),
    animated: Object.freeze({
      counts: Object.freeze([8, 16, 24]),
      mainFormat: 'APNG', stickerFormat: 'APNG', stickerMaxWidth: 320, stickerMaxHeight: 270,
      framesMin: 5, framesMax: 20, loopsMin: 1, loopsMax: 4,
      totalDurationMax: 4, allowedDurations: Object.freeze([1, 2, 3, 4]),
      sticker: Object.freeze({
        format: 'APNG', maxWidth: 320, maxHeight: 270, minEitherDimension: 270,
        sameFrameDimensions: true, framesMin: 5, framesMax: 20,
        loopsMin: 1, loopsMax: 4, allowedDurations: Object.freeze([1, 2, 3, 4]),
        totalDurationMax: 4, removeFrameMargins: true, removeStaticParts: true,
        firstFrameUsedAsStill: true
      })
    })
  });
  // Project v1 keeps stickers empty. Phase 2 objects will carry a stable 1-based `slot` field.
  const STICKER_SLOT_POLICY = Object.freeze({ strategy: 'explicit-slot', field: 'slot', firstSlot: 1 });
  function constraints(type) {
    if (type !== 'static' && type !== 'animated') throw new Error('LINE Project typeはstaticまたはanimatedです。');
    return LIMITS[type];
  }
  function createProject(type = 'static', targetStickerCount) {
    const rule = constraints(type), count = targetStickerCount ?? rule.counts[0];
    if (!rule.counts.includes(count)) throw new Error(`${type}では${count}個を選択できません。`);
    return { format: 'line-stamp-project', version: 1, type, targetStickerCount: count, mainImage: null, tabImage: null, stickers: [] };
  }
  function normalizeStickerCount(type, currentCount) {
    const counts = constraints(type).counts;
    const available = counts.filter(count => count <= currentCount);
    return available.length ? available[available.length - 1] : counts[0];
  }
  function stickerSlotNumbers(targetStickerCount) {
    if (!Number.isSafeInteger(targetStickerCount) || targetStickerCount < 1) throw new Error('スタンプ予定数が不正です。');
    return Array.from({ length: targetStickerCount }, (_, index) => STICKER_SLOT_POLICY.firstSlot + index);
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
    constraints(type);
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('LINE ProjectがObjectではありません。');
    return { ...project, type, targetStickerCount: normalizeStickerCount(type, project.targetStickerCount) };
  }
  return { LIMITS, STICKER_SLOT_POLICY, constraints, createProject, validateProject, normalizeStickerCount, stickerSlotNumbers, changeType };
});
