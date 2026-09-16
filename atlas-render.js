/* 描画計画を変更せずCanvasに描く。アプリとブラウザテストで共用。 */
(function () {
  'use strict';
  function render(canvas, items, plan, settings) {
    canvas.width = plan.width; canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvasを初期化できません。画像数やサイズを減らしてください。');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = settings.smoothing === 'smooth';
    ctx.imageSmoothingQuality = 'high';
    for (const sprite of plan.sprites) {
      const b = sprite.bounds, d = sprite.contentDraw;
      ctx.save();
      // 隣のセルへの補間のにじみも防ぐ。
      ctx.beginPath(); ctx.rect(sprite.x, sprite.y, sprite.width, sprite.height); ctx.clip();
      ctx.drawImage(items[sprite.index].image, b.x, b.y, b.width, b.height,
        sprite.x + d.x, sprite.y + d.y, d.width, d.height);
      ctx.restore();
    }
    // 一部ブラウザでは巨大Canvasの確保失敗が遅れて現れる。
    ctx.getImageData(0, 0, 1, 1);
  }
  function pngBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(blob => blob && blob.size ? resolve(blob) : reject(new Error('PNG生成に失敗しました。出力サイズを小さくしてください。')), 'image/png');
      } catch (error) { reject(new Error(`PNG生成に失敗しました: ${error.message}`)); }
    });
  }
  // 完成Atlasのセルをそのまま使い、配置・補間・クリップ処理を重複させない。
  function renderPreview(canvas, atlas, sprite, settings) {
    canvas.width = sprite?.width || 1; canvas.height = sprite?.height || 1;
    canvas.style.imageRendering = settings.smoothing === 'pixel' ? 'pixelated' : 'auto';
    if (!sprite) return;
    canvas.getContext('2d').drawImage(atlas, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, sprite.width, sprite.height);
  }
  window.AtlasRenderer = Object.freeze({ render, pngBlob, renderPreview });
})();
