(async function () {
  'use strict';
  const C = window.AtlasCore, R = window.AtlasRenderer, T = window.AtlasTests;
  const results = T.run();
  async function test(name, run) { try { await run(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error: error.message }); } }
  function makeSource(color, x, y, width, height) {
    const image = document.createElement('canvas'); image.width = width + 10; image.height = height + 10;
    const ctx = image.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(x, y, width, height);
    const analysis = C.analyzeAlpha(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height);
    const bounds = C.alphaBounds(analysis, 1);
    return { image, bounds, trim: C.addMargin(bounds, 0), name: color, source: color + '.png', width: image.width, height: image.height };
  }
  const settings = { ...C.DEFAULTS, cellWidth: 32, cellHeight: 32, padding: 4, columns: 3, pot: true, upscale: false, smoothing: 'pixel', alignment: 'bottom-center', scaleMode: 'uniform' };
  const items = [makeSource('red', 2, 3, 8, 12), makeSource('blue', 1, 2, 16, 8), makeSource('lime', 3, 1, 10, 10), makeSource('yellow', 2, 2, 8, 8)];
  const plan = C.makePlan(items, settings), canvas = document.getElementById('testCanvas');
  await test('実CanvasのPNG生成・実ピクセルサイズ', async () => {
    R.render(canvas, items, plan, settings);
    const blob = await R.pngBlob(canvas); T.equal(blob.type, 'image/png');
    const bitmap = await createImageBitmap(blob); T.equal([bitmap.width, bitmap.height], [128, 64]);
    const decoded = document.createElement('canvas'); decoded.width = bitmap.width; decoded.height = bitmap.height;
    decoded.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
    const data = decoded.getContext('2d').getImageData(0, 0, decoded.width, decoded.height).data;
    window.testPngData = { data, width: decoded.width, height: decoded.height };
  });
  await test('PNG全画素がJSONのcontentDrawと一致・未使用セル/POT領域/背景は透明', () => {
    const { data, width, height } = window.testPngData;
    const json = JSON.parse(JSON.stringify(C.metadata(plan, settings, 'test.png')));
    const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255], [255, 255, 0, 255]];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sprite = json.sprites.find(s => x >= s.x + s.contentDraw.x && x < s.x + s.contentDraw.x + s.contentDraw.width && y >= s.y + s.contentDraw.y && y < s.y + s.contentDraw.y + s.contentDraw.height);
      const actual = Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
      T.equal(actual, sprite ? colors[sprite.index] : [0, 0, 0, 0]);
    }
  });
  await test('トリム追加余白のPNG描画・元画像の端でも透明', async () => {
    const source = makeSource('red', 0, 0, 4, 4); source.trim = C.addMargin(source.bounds, 3);
    const s = { ...settings, columns: 1, alignment: 'top-left' }, p = C.makePlan([source], s), c = document.createElement('canvas');
    R.render(c, [source], p, s); const ctx = c.getContext('2d');
    T.equal(Array.from(ctx.getImageData(4, 4, 1, 1).data), [0, 0, 0, 0]); T.equal(Array.from(ctx.getImageData(7, 7, 1, 1).data), [255, 0, 0, 255]);
  });
  await test('Smooth / PixelのCanvas設定', () => {
    for (const smoothing of ['smooth', 'pixel']) {
      const c = document.createElement('canvas'); R.render(c, items, plan, { ...settings, smoothing });
      T.equal(c.getContext('2d').imageSmoothingEnabled, smoothing === 'smooth'); T.equal(c.getContext('2d').imageSmoothingQuality, 'high');
    }
  });
  await test('PNG生成失敗はPromiseのエラーとして処理', async () => {
    let rejected = false; try { await R.pngBlob({ toBlob: cb => cb(null) }); } catch { rejected = true; } T.equal(rejected, true);
  });
  for (const extracted of [false, true]) await test(`${extracted ? '抽出' : '通常'}スプライトのoffset変更がPNG全画素とJSONへ一致`, async () => {
    const source = makeSource('red', 0, 0, 4, 6);
    if (extracted) source.anchor = { centroidX: 1.5, bottomY: 5 };
    source.trim = C.addMargin(source.bounds, 2);
    for (const [offsetX, offsetY] of [[0,0],[-3,-2],[2,1]]) {
      Object.assign(source, { offsetX, offsetY });
      const s = { ...settings, columns: 1, pot: false }, p = C.makePlan([source], s), c = document.createElement('canvas');
      R.render(c, [source], p, s); const bitmap = await createImageBitmap(await R.pngBlob(c));
      const ctx = c.getContext('2d'); ctx.clearRect(0,0,32,32); ctx.drawImage(bitmap,0,0); bitmap.close();
      const data = ctx.getImageData(0,0,32,32).data, d = C.metadata(p,s,'test.png').sprites[0].contentDraw;
      for (let y=0;y<32;y++) for(let x=0;x<32;x++) T.equal(data[(y*32+x)*4+3], x>=d.x && x<d.x+d.width && y>=d.y && y<d.y+d.height ? 255 : 0);
    }
  });
  for (const r of results) { const li = document.createElement('li'); li.textContent = `${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.error ? ': ' + r.error : ''}`; li.style.color = r.ok ? '#17694f' : '#b32424'; document.getElementById('testResults').append(li); }
  const passed = results.filter(r => r.ok).length;
  document.getElementById('testSummary').textContent = `${passed} / ${results.length} 成功`;
  document.body.dataset.testStatus = passed === results.length ? 'passed' : 'failed';
  document.title = `${passed}/${results.length} ${document.body.dataset.testStatus} — Sprite Atlas tests`;
  delete window.testPngData;
})();
