/* Node: node core-tests.js / ブラウザ: tests.html */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const C = node ? require('./atlas-core.js') : root.AtlasCore;
  const L = node ? require('./line-core.js') : root.LineStampCore;
  const W = node ? require('./workspace-shell.js') : root.WorkspaceShell;
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
  test('Tagsのtrim・空要素・完全一致重複・大文字小文字', () => {
    equal(C.normalizeTags(' purple, walk, ,purple, Walk, character:purple '), ['purple','walk','Walk','character:purple']);
    equal(C.normalizeTags([]), []);
  });
  test('Tagsは最大32個・各64文字・型不正を拒否', () => {
    equal(C.normalizeTags(Array.from({length:32},(_,i)=>`tag${i}`)).length,32);
    throws(()=>C.normalizeTags(Array.from({length:33},(_,i)=>`tag${i}`)));
    throws(()=>C.normalizeTags(['x'.repeat(65)])); throws(()=>C.normalizeTags([1]));
  });
  test('Gridは非正方形Cell・512セル・64列/行境界を許可', () => {
    equal(C.validateGrid({imageWidth:1280,imageHeight:684,cellWidth:160,cellHeight:228,columns:8,rows:3}).cells,24);
    equal(C.validateGrid({imageWidth:64,imageHeight:8,cellWidth:1,cellHeight:1,columns:64,rows:8}).cells,512);
    equal(C.validateGrid({imageWidth:8,imageHeight:64,cellWidth:1,cellHeight:1,columns:8,rows:64}).cells,512);
  });
  test('Gridは513セル・65列/行・寸法不一致・不正値を拒否', () => {
    throws(()=>C.validateGrid({imageWidth:27,imageHeight:19,cellWidth:1,cellHeight:1,columns:27,rows:19}));
    throws(()=>C.validateGrid({imageWidth:65,imageHeight:1,cellWidth:1,cellHeight:1,columns:65,rows:1}));
    throws(()=>C.validateGrid({imageWidth:1,imageHeight:65,cellWidth:1,cellHeight:1,columns:1,rows:65}));
    throws(()=>C.validateGrid({imageWidth:10,imageHeight:10,cellWidth:3,cellHeight:5,columns:3,rows:2}));
    throws(()=>C.validateGrid({imageWidth:10,imageHeight:10,cellWidth:0,cellHeight:5,columns:2,rows:2}));
  });
  test('Grid追加容量はmaxImages・totalPixels超過前に一括拒否', () => {
    equal(C.validateAddition(483,1000,17,1700),{count:500,pixels:2700});
    throws(()=>C.validateAddition(484,1000,17,1700));
    throws(()=>C.validateAddition(0,C.LIMITS.maxTotalSourcePixels-10,1,11));
  });
  test('Grid推定は透明境界の8列×3行を候補提示', () => {
    const width=80,height=30,data=new Uint8ClampedArray(width*height*4);
    for(let row=0;row<3;row++)for(let col=0;col<8;col++){if(row===2&&col>0)continue;for(let y=row*10+2;y<row*10+8;y++)for(let x=col*10+2;x<col*10+8;x++)data[(y*width+x)*4+3]=255;}
    equal(C.inferGrid(data,width,height),{columns:8,rows:3,cellWidth:10,cellHeight:10,confidence:'suggested'});
  });
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
  const animated = (name, groupId, animationOrder, durationFrames) => ({ ...item(10,20,name), groupId, animationOrder, durationFrames });
  test('Animation未所属・空白のみを除外し従来用途もversion2で出力', () => {
    const s=settings(), p=C.makePlan([item(10,20),animated('b','  ',0,1)],s), json=C.metadata(p,s,'test.png');
    equal(Object.keys(json.animations),[]); equal(json.meta.version,2); equal(json.sprites,p.sprites);
  });
  test('同一Groupはtrimして集約・order昇順・同値はAtlas順・duration出力', () => {
    const s=settings(), p=C.makePlan([animated('a',' walk ',2,3),animated('b','walk',0,6),animated('c','walk',2,9)],s);
    const groups=new Map([['walk',{id:'walk',fps:24}]]), json=C.metadata(p,s,'a.png',groups);
    equal(json.animations.walk,{fps:24,frames:[{sprite:1,duration:6},{sprite:0,duration:3},{sprite:2,duration:9}]});
    equal(p.sprites.map(i=>i.name),['a','b','c']); equal(p.sprites[0].groupId,'walk');
  });
  test('FPSはGroupごとに共有・複数Group独立・未使用Groupは出力しない', () => {
    const s=settings(), p=C.makePlan([animated('a','a',0,1),animated('b','a',1,2),animated('c','b',0,1)],s);
    const groups=new Map([['a',{fps:30}],['b',{fps:12}],['unused',{fps:1}]]);
    const json=C.metadata(p,s,'a.png',groups); equal(Object.keys(json.animations),['a','b']); equal(json.animations.a.fps,30); equal(json.animations.b.fps,12);
    equal(p.sprites.some(s=>Object.hasOwn(s,'fps')),false); groups.set('a',{fps:60}); equal(C.metadata(p,s,'a.png',groups).animations.a.fps,60);
  });
  test('60fpsで3f=50ms・6f=100ms', () => { near(C.durationMs(3,60),50); near(C.durationMs(6,60),100); });
  test('不正FPS・duration・order・group型を拒否', () => {
    for(const fps of [0,-1,NaN,Infinity,'60',null]) throws(()=>C.durationMs(3,fps));
    for(const durationFrames of [0,-1,1.5,NaN,Infinity,null]) throws(()=>C.makePlan([animated('a','walk',0,durationFrames)],settings()));
    for(const animationOrder of [-1,.5,NaN,Infinity,null]) throws(()=>C.makePlan([animated('a','walk',animationOrder,1)],settings()));
    throws(()=>C.animationProperties({groupId:{}}));
    const p=C.makePlan([animated('a','walk',0,1)],settings()); throws(()=>C.buildAnimations(p.sprites,new Map([['walk',{fps:0}]])));
    equal(C.validateAnimations([animated('a','walk',-1,1)],new Map()).length,1);
  });
  test('特殊Group IDも安全にJSON往復', () => {
    const p=C.makePlan(['__proto__','constructor','toString'].map(name=>animated(name,name,0,1)),settings());
    const json=C.metadata(p,settings(),'a.png'); equal(Object.getPrototypeOf(json.animations),null);
    const roundtrip=JSON.parse(JSON.stringify(json)); equal(roundtrip.animations.__proto__.frames,[{sprite:0,duration:1}]); equal(roundtrip.animations.constructor.fps,60);
  });
  test('Atlas並べ替えは明示Animation順を変えずindex参照だけ更新', () => {
    const a=animated('a','walk',2,3), b=animated('b','walk',1,6), s=settings();
    for(const items of [[a,b],[b,a]]) { const p=C.makePlan(items,s), j=C.metadata(p,s,'a.png'); equal(j.animations.walk.frames.map(f=>j.sprites[f.sprite].name),['b','a']); }
  });
  test('通常・抽出を同じAnimationへ追加・offsetとmeta/spritesの整合', () => {
    const a=animated('normal','walk',1,3), b=animated('split','walk',0,6); b.anchor={centroidX:2,bottomY:19}; b.offsetX=3; b.offsetY=-2;
    const s=settings(), p=C.makePlan([a,b],s), j=C.metadata(p,s,'a.png');
    equal(j.animations.walk.frames.map(f=>f.sprite),[1,0]); equal(j.sprites,p.sprites); equal(j.meta.atlasWidth,p.width);
    for(const f of j.animations.walk.frames) equal(j.sprites[f.sprite].durationFrames,f.duration);
  });
  test('Runtime JSONは正規化済みTagsを追加フィールドとして出力', () => {
    const i=item(10,10);i.tags=[' purple ','walk','walk'];const sprite=C.makePlan([i],settings()).sprites[0];equal(sprite.tags,['purple','walk']);
  });
  test('Project v1構造・Tags・Animation・Group FPSを検証', () => {
    const project={format:'sprite-atlas-project',version:1,settings:settings(),groups:[{id:'walk',fps:24}],sprites:[{
      name:'hero',source:'hero.png',tags:[' purple ','walk'],width:2,height:3,image:'data:image/png;base64,AA==',offsetX:1,offsetY:-2,extracted:false,groupId:'walk',animationOrder:2,durationFrames:3}]};
    const validated=C.validateProject(project);equal(validated.settings,settings());equal(validated.sprites[0].tags,['purple','walk']);equal(validated.groups.get('walk').fps,24);
    for(const mutate of [p=>p.format='wrong',p=>p.version=2,p=>p.settings.cellWidth=0,p=>p.sprites[0].tags=['x'.repeat(65)],p=>p.sprites[0].animationOrder=-1,p=>p.groups[0].fps=0]){
      const broken=JSON.parse(JSON.stringify(project));mutate(broken);throws(()=>C.validateProject(broken));
    }
  });
  test('Project v2は通常/Compact・縮小率を検証しv1互換を維持', () => {
    const sprite={name:'hero',source:'hero.png',tags:[],width:20,height:30,image:'data:image/png;base64,AA==',offsetX:0,offsetY:0,extracted:false,groupId:'',animationOrder:0,durationFrames:1,sourceScaleX:.25,sourceScaleY:.5};
    for(const storageMode of ['standard','compact']) {
      const p={format:'sprite-atlas-project',version:2,storageMode,settings:settings(),groups:[],sprites:[sprite]};
      const v=C.validateProject(p);equal([v.version,v.storageMode,v.sprites[0].sourceScaleX,v.sprites[0].sourceScaleY],[2,storageMode,.25,.5]);
    }
    for(const change of [p=>p.storageMode='zip',p=>p.sprites[0].sourceScaleX=0,p=>p.sprites[0].sourceScaleY=1.1]) {
      const p={format:'sprite-atlas-project',version:2,storageMode:'compact',settings:settings(),groups:[],sprites:[{...sprite}]};change(p);throws(()=>C.validateProject(p));
    }
    equal(C.itemTrim({x:2,y:3,width:10,height:20},8,{sourceScaleX:.25,sourceScaleY:.5}),{x:0,y:-1,width:14,height:28});
  });
  test('LINE Static / Animatedの制約と初期Project', () => {
    equal(L.LIMITS.static.counts,[8,16,24,32,40]); equal(L.LIMITS.animated.counts,[8,16,24]);
    equal(L.LIMITS.mainImage,{width:240,height:240}); equal(L.LIMITS.tabImage,{width:96,height:74,format:'PNG'});
    equal(L.LIMITS.maxFileBytes,1048576); equal(L.createProject(),{format:'line-stamp-project',version:1,type:'static',targetStickerCount:8,mainImage:null,tabImage:null,stickers:[]});
  });
  test('LINE Project type/count SAVE→LOAD相当のJSON往復', () => {
    for(const [type,counts] of [['static',[8,16,24,32,40]],['animated',[8,16,24]]]) for(const count of counts) {
      const project=L.createProject(type,count); equal(L.validateProject(JSON.parse(JSON.stringify(project))),project);
    }
    equal(L.changeType(L.createProject('static',40),'animated').targetStickerCount,24);
  });
  test('LINE type変更は現在値以下の最大Sticker数へ丸める', () => {
    for(const [from,to,expected] of [[40,'animated',24],[32,'animated',24],[24,'animated',24],[16,'animated',16],[8,'animated',8],[24,'static',24]]) {
      const source=L.createProject(to==='static'?'animated':'static',from); equal(L.normalizeStickerCount(to,from),expected); equal(L.changeType(source,to).targetStickerCount,expected);
    }
  });
  test('LINE type変更は元Projectをmutateせず将来データを保持', () => {
    const mainImage={id:'main'},tabImage={id:'tab'},stickers=[{slot:3,id:'third'}],editing={selectedSlot:3};
    const source={format:'line-stamp-project',version:1,type:'static',targetStickerCount:40,mainImage,tabImage,stickers,editing,futureField:'keep'};
    const before={...source},changed=L.changeType(source,'animated');
    equal(source,before); equal(changed,{...source,type:'animated',targetStickerCount:24});
    if(changed===source||changed.mainImage!==mainImage||changed.tabImage!==tabImage||changed.stickers!==stickers||changed.editing!==editing)throw new Error('既存Projectデータを保持していません。');
  });
  test('LINE仕様定数は共通・Static固有・Animated固有を分離', () => {
    equal(L.LIMITS.common,{maxFileBytes:1048576,maxZipBytes:62914560,colorMode:'RGB',transparentBackground:true});
    equal(L.LIMITS.static.sticker,{format:'PNG',maxWidth:370,maxHeight:320,dimensionMultiple:2,minDpi:72,recommendedOuterMarginPx:10});
    equal(L.LIMITS.animated.sticker,{format:'APNG',maxWidth:320,maxHeight:270,minEitherDimension:270,sameFrameDimensions:true,framesMin:5,framesMax:20,loopsMin:1,loopsMax:4,allowedDurations:[1,2,3,4],totalDurationMax:4,removeFrameMargins:true,removeStaticParts:true,firstFrameUsedAsStill:true});
    if('dimensionMultiple' in L.LIMITS.animated.sticker||'minDpi' in L.LIMITS.animated.sticker)throw new Error('Static固有制約がAnimatedへ混入しています。');
  });
  test('将来Stickerは明示的な1-based slotで安定管理する', () => {
    equal(L.STICKER_SLOT_POLICY,{strategy:'explicit-slot',field:'slot',firstSlot:1}); equal(L.stickerSlotNumbers(8),[1,2,3,4,5,6,7,8]); throws(()=>L.stickerSlotNumbers(0));
  });
  test('malformed LINE Projectを拒否し入力を変更しない', () => {
    const current=L.createProject('static',16), signature=JSON.stringify(current);
    for(const change of [p=>p.format='wrong',p=>p.version=2,p=>p.type='video',p=>p.targetStickerCount=40,p=>p.mainImage={},p=>p.tabImage={},p=>p.stickers=[{}]]) {
      const broken=JSON.parse(JSON.stringify(L.createProject('animated',8))); change(broken); throws(()=>L.validateProject(broken)); equal(JSON.stringify(current),signature);
    }
  });
  test('workspace dirtyは独立し切替相当のactive変更で維持', () => {
    const state=W.createState(); W.setDirtyState(state,'atlas',true); state.active='line'; equal([state.atlas.dirty,state.line.dirty,W.hasUnsavedChanges(state)],[true,false,true]);
    W.setDirtyState(state,'line',true); state.active='atlas'; equal([state.atlas.dirty,state.line.dirty],[true,true]); W.setDirtyState(state,'atlas',false); equal([state.atlas.dirty,state.line.dirty,W.hasUnsavedChanges(state)],[false,true,true]);
    W.setDirtyState(state,'line',false); equal(W.hasUnsavedChanges(state),false);
  });
  test('経過時間再生の境界・遅延・ループ・非ループ終端', () => {
    const a={fps:60,frames:[{sprite:2,duration:3},{sprite:0,duration:6}]};
    equal(C.animationFrameAt(a,0),{index:0,sprite:2,done:false}); equal(C.animationFrameAt(a,49).sprite,2);
    equal(C.animationFrameAt(a,50).sprite,0); equal(C.animationFrameAt(a,149).sprite,0); equal(C.animationFrameAt(a,150).sprite,2);
    equal(C.animationFrameAt(a,150*1000+75).sprite,0); equal(C.animationFrameAt(a,999,false),{index:1,sprite:0,done:true});
    equal(C.animationFrameAt({fps:60,frames:[]},0),null); throws(()=>C.animationFrameAt(a,-1));
  });
  function run() { return tests.map(t => { try { t.run(); return { name: t.name, ok: true }; } catch (e) { return { name: t.name, ok: false, error: e.message }; } }); }
  if (typeof module !== 'undefined' && module.exports) {
    const results = run(); results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ': ' + r.error : ''}`));
    console.log(`${results.filter(r => r.ok).length}/${results.length} passed`); if (results.some(r => !r.ok)) process.exitCode = 1;
  } else root.AtlasTests = { run, equal, near };
})(typeof globalThis !== 'undefined' ? globalThis : this);
