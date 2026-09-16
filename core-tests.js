/* Node: node core-tests.js / ブラウザ: tests.html */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./atlas-core.js') : root.AtlasCore;
  const tests = [];
  function test(name, run) { tests.push({ name, run }); }
  function equal(actual, expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`期待値 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`); }
  function near(a, b) { if (Math.abs(a - b) > 1e-8) throw new Error(`${a} != ${b}`); }
  function throws(fn) { let failed = false; try { fn(); } catch { failed = true; } if (!failed) throw new Error('エラーになりませんでした'); }
  const settings = extras => ({ ...C.DEFAULTS, ...extras });
  function item(width, height, name = 'sprite') { return { name, source: name + '.png', width, height, trim: { x: 0, y: 0, width, height }, bounds: { x: 0, y: 0, width, height } }; }
  test('透明余白のBounding Box（非正方形・端の画素を含む）', () => {
    const data = new Uint8ClampedArray(7 * 5 * 4); data[(1 * 7 + 2) * 4 + 3] = 255; data[(4 * 7 + 6) * 4 + 3] = 2;
    equal(C.alphaBounds(C.analyzeAlpha(data, 7, 5), 1), { x: 2, y: 1, width: 5, height: 4 });
  });
  test('alpha > threshold の厳密な境界・255で有効画素なし', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 1, 0, 0, 0, 2]); const a = C.analyzeAlpha(data, 2, 1);
    equal(C.alphaBounds(a, 1), { x: 1, y: 0, width: 1, height: 1 }); equal(C.alphaBounds(a, 255), null);
    equal(C.alphaBounds(a, 0), { x: 0, y: 0, width: 2, height: 1 });
  });
  test('完全透明画像は有効領域なし', () => equal(C.alphaBounds(C.analyzeAlpha(new Uint8ClampedArray(16), 2, 2), 1), null));
  test('全面不透明画像の判定', () => { const a = C.analyzeAlpha(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1); equal(a.opaque, true); equal(C.alphaBounds(a, 1), { x: 0, y: 0, width: 1, height: 1 }); });
  test('トリム追加余白は元画像の端でも確保する', () => equal(C.addMargin({ x: 0, y: 1, width: 10, height: 20 }, 3), { x: -3, y: -2, width: 16, height: 26 }));
  test('128×128・余白8・縦長画像のcontain', () => { const p = C.makePlan([item(100, 200)], settings()); near(p.sprites[0].draw.width, 56); near(p.sprites[0].draw.height, 112); });
  test('横長画像でもアスペクト比を維持', () => { const p = C.makePlan([item(300, 100)], settings()); near(p.sprites[0].draw.width, 112); near(p.sprites[0].draw.width / p.sprites[0].draw.height, 3); });
  test('Individual Fitは画像ごとに最大化する', () => { const p = C.makePlan([item(20, 40), item(100, 200)], settings()); near(p.sprites[0].scale, 2.8); near(p.sprites[1].scale, .56); near(p.sprites[0].draw.height, 112); });
  test('Uniform Scaleは縦横それぞれ異なる最大画像でも同一倍率', () => {
    const p = C.makePlan([item(200, 20), item(30, 400), item(20, 20)], settings({ scaleMode: 'uniform' }));
    p.sprites.forEach(s => near(s.scale, .28)); near(p.sprites[2].draw.width, 5.6);
  });
  test('拡大OFFは両モードで倍率1以下', () => {
    for (const scaleMode of ['individual', 'uniform']) { const p = C.makePlan([item(20, 20)], settings({ scaleMode, upscale: false })); near(p.sprites[0].scale, 1); }
  });
  test('center / bottom-center 配置', () => {
    equal(C.align(60, 40, settings()), { x: 34, y: 44, width: 60, height: 40 });
    equal(C.align(60, 40, settings({ alignment: 'bottom-center' })), { x: 34, y: 80, width: 60, height: 40 });
  });
  test('9点配置は全てセル内に収まる', () => { for (const alignment of C.ALIGNMENTS) { const a = C.align(20, 30, settings({ alignment })); if (a.x < 8 || a.y < 8 || a.x + a.width > 120 || a.y + a.height > 120) throw new Error(alignment); } });
  test('columnsによる折返し・セル座標', () => { const p = C.makePlan(Array.from({ length: 6 }, () => item(10, 10)), settings()); equal(p.rows, 2); equal([p.sprites[4].x, p.sprites[4].y], [0, 128]); equal([p.sprites[5].x, p.sprites[5].y], [128, 128]); });
  test('POT拡張640×384 → 1024×512、セル座標不変', () => {
    const s = settings({ columns: 5, pot: true }), p = C.makePlan(Array.from({ length: 11 }, () => item(10, 10)), s);
    equal([p.width, p.height], [1024, 512]); equal([p.sprites[10].x, p.sprites[10].y], [0, 256]); equal(C.nextPowerOfTwo(512), 512);
  });
  test('JSONの座標と描画計画は一致する', () => { const s = settings(), p = C.makePlan([item(37, 91)], s), json = C.metadata(p, s, '20260916_0000.png'); equal(json.sprites, p.sprites); equal(json.meta.atlasWidth, p.width); equal(json.meta.image, '20260916_0000.png'); });
  test('画像0枚・過大Canvas・不正数値を拒否', () => {
    throws(() => C.layout(0, settings())); throws(() => C.layout(10, settings({ cellWidth: 9000 })));
    throws(() => C.layout(2, settings({ cellWidth: 8192, cellHeight: 8192, columns: 1 })));
    for (const extra of [{ cellWidth: 0 }, { cellHeight: 1.5 }, { padding: 64 }, { columns: NaN }, { columns: Infinity }, { margin: -1 }, { threshold: 256 }, { padding: -1 }]) throws(() => C.layout(1, settings(extra)));
  });
  test('設定復元：不正値・型不一致を初期値に戻す', () => { equal(C.restoreSettings({ cellWidth: '256', scaleMode: 'other', pot: 'true' }), { ...C.DEFAULTS }); equal(C.restoreSettings(null), { ...C.DEFAULTS }); });
  test('設定復元：大きいセルと余白の組み合わせを保持', () => { const s = settings({ cellWidth: 512, cellHeight: 512, padding: 100 }); equal(C.restoreSettings(s), s); });
  test('設定復元：相互制約違反は初期値へ', () => equal(C.restoreSettings({ cellWidth: 10, padding: 8 }), { ...C.DEFAULTS }));
  test('名前重複・空白・特殊名の一意化', () => { equal(C.uniqueName('idle', new Set(['idle', 'idle_2'])), 'idle_3'); equal(C.uniqueName('  ', new Set()), 'sprite'); equal(C.uniqueName('__proto__', new Set()), '__proto__'); });
  test('連番・日付変更・壊れた保存値・4桁以上', () => {
    equal(C.nextSequence({ date: '20260916', last: 2 }, '20260916'), 3); equal(C.nextSequence({ date: '20260915', last: 99 }, '20260916'), 0);
    equal(C.nextSequence(null, '20260916'), 0); equal(C.nextSequence({ date: '20260916', last: '3' }, '20260916'), 0);
    equal(C.basename('20260916', 0), '20260916_0000'); equal(C.basename('20260916', 10000), '20260916_10000');
  });
  test('ローカル日付を使用', () => equal(C.localDate(new Date(2026, 8, 16, 0, 0)), '20260916'));
  function pixels(w, h, points) { const data = new Uint8ClampedArray(w * h * 4); for (const [x, y, a = 255] of points) data[(y * w + x) * 4 + 3] = a; return data; }
  test('3島を検出して左から右', () => {
    const d = C.detectIslands(pixels(10, 5, [[8, 0], [1, 4], [5, 2]]), 10, 5, 1, 1);
    equal(d.islands.map(i => i.bounds.x), [1, 5, 8]);
  });
  test('8近傍・重心X・下端Y・画素数・bbox', () => {
    const d = C.detectIslands(pixels(6, 5, [[1, 1], [2, 2], [3, 3], [2, 3]]), 6, 5, 1, 1);
    equal(d.islands.length, 1); const i = d.islands[0];
    equal(i.bounds, { x: 1, y: 1, width: 3, height: 3 }); equal(i.pixelCount, 4); equal(i.centroidX, 2); equal(i.bottomY, 3);
  });
  test('透明0件・厳密alpha境界・ゴミ島除外', () => {
    equal(C.detectIslands(pixels(5, 3, []), 5, 3, 1).islands.length, 0);
    const data = pixels(5, 3, [[0, 0, 2], [1, 0, 2], [4, 2, 2], [2, 0, 1]]);
    equal(C.detectIslands(data, 5, 3, 1, 2).islands.map(i => i.pixelCount), [2]);
    equal(C.detectIslands(data, 5, 3, 255, 1).islands.length, 0);
  });
  test('8島は許可・9島は拒否・除外後に上限判定', () => {
    const points = Array.from({ length: 9 }, (_, i) => [i * 2, 0]);
    throws(() => C.detectIslands(pixels(19, 1, points), 19, 1, 1, 1));
    equal(C.detectIslands(pixels(19, 1, points), 19, 1, 1, 2).islands.length, 0);
    equal(C.detectIslands(pixels(19, 1, points.slice(0,8)), 19, 1, 1, 1).islands.length, 8);
  });
  test('重なるbboxの島を独立抽出', () => {
    const points = [[0,0],[1,0],[2,0],[3,0],[4,0],[0,1],[0,2],[0,3],[0,4],[1,4],[2,4],[3,4],[4,4],[3,2]];
    const data = pixels(5, 5, points), d = C.detectIslands(data, 5, 5, 1, 1);
    equal(d.islands.length, 2); equal(C.cropIsland(data, 5, d, d.islands[0])[(2 * 5 + 3) * 4 + 3], 0);
  });
  test('重心中心・下端配置と両倍率モード', () => {
    for (const scaleMode of ['individual', 'uniform']) {
      const i = item(6, 8); i.anchor = { centroidX: 1, bottomY: 7 }; i.trim = C.addMargin(i.bounds, 2);
      const s = settings({ scaleMode }), p = C.makePlan([i], s).sprites[0];
      near(p.draw.x + (1.5 - i.trim.x) * p.scale, 64);
      near(p.draw.y + (8 - i.trim.y) * p.scale, 120);
      if (p.draw.x < s.padding - 1e-8 || p.draw.x + p.draw.width > 120 + 1e-8) throw new Error('横幅超過');
    }
  });
  test('offset出力px加算・JSON反映・通常配置回帰', () => {
    const s = settings(), i = item(10, 20), before = C.makePlan([i], s).sprites[0];
    equal(before.draw, C.align(56, 112, s)); i.offsetX = -3; i.offsetY = 2;
    const after = C.metadata(C.makePlan([i], s), s, 'test.png').sprites[0];
    near(after.draw.x, before.draw.x - 3); near(after.contentDraw.y, before.contentDraw.y + 2);
    equal([after.offsetX, after.offsetY], [-3, 2]); i.offsetX = NaN; throws(() => C.makePlan([i], s));
  });
  test('しきい値変更後anchor・最小画素設定保存', () => {
    const a = C.analyzeAlpha(pixels(5, 3, [[0,0,2],[4,2,255]]), 5, 3);
    equal(C.alphaAnchor(a, 1), { centroidX: 2, bottomY: 2, pixelCount: 2 });
    equal(C.alphaAnchor(a, 2), { centroidX: 4, bottomY: 2, pixelCount: 1 }); equal(C.alphaAnchor(a, 255), null);
    equal(C.restoreSettings({ minIslandPixels: 2 }).minIslandPixels, 2); equal(C.restoreSettings({ minIslandPixels: 0 }).minIslandPixels, 100);
  });
  test('6キャラと多数の低alphaノイズ：100画素除外後に6件', () => {
    const points = [];
    for (let i = 0; i < 6; i++) for (let y = 4; y < 14; y++) for (let x = i * 12; x < i * 12 + 10; x++) points.push([x, y]);
    // 走査順でキャラより先に9個以上のノイズを置く。
    for (let x = 0; x < 72; x += 2) points.push([x, 0, 2]);
    const data = pixels(72, 14, points), d = C.detectIslands(data, 72, 14, 1);
    equal(d.rawCount, 42); equal(d.discardedCount, 36); equal(d.islands.length, 6);
    equal(d.islands.map(i => i.pixelCount), [100,100,100,100,100,100]);
    equal(C.detectIslands(data, 72, 14, 1, 101).islands.length, 0);
    throws(() => C.detectIslands(data, 72, 14, 1, 1));
  });
  test('通常・分割共通のoffset初期値と加算：両倍率モード・9点配置', () => {
    for (const extracted of [false, true]) for (const scaleMode of ['individual', 'uniform']) for (const alignment of C.ALIGNMENTS) {
      const i = item(10, 20), s = settings({ scaleMode, alignment });
      if (extracted) i.anchor = { centroidX: 3, bottomY: 19 };
      const before = C.makePlan([i], s).sprites[0]; equal([before.offsetX, before.offsetY], [0, 0]);
      i.offsetX = 3; i.offsetY = -2;
      const after = C.metadata(C.makePlan([i], s), s, 'test.png').sprites[0];
      near(after.draw.x, before.draw.x + 3); near(after.draw.y, before.draw.y - 2);
      near(after.contentDraw.x, before.contentDraw.x + 3); near(after.contentDraw.y, before.contentDraw.y - 2);
      equal(after.scale, before.scale); equal([after.offsetX, after.offsetY], [3, -2]);
    }
  });
  function run() { return tests.map(t => { try { t.run(); return { name: t.name, ok: true }; } catch (e) { return { name: t.name, ok: false, error: e.message }; } }); }
  if (typeof module !== 'undefined' && module.exports) {
    const results = run(); results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ': ' + r.error : ''}`));
    console.log(`${results.filter(r => r.ok).length}/${results.length} passed`); if (results.some(r => !r.ok)) process.exitCode = 1;
  } else root.AtlasTests = { run, equal, near };
})(typeof globalThis !== 'undefined' ? globalThis : this);
