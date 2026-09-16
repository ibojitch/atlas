/* 任意の開発用テスト。Node 22以降とインストール済みChromeのみ（npm不要）。
 * 一時プロファイルでfile://のアプリを操作。ダウンロード先も一時フォルダ。
 * 実ユーザーの設定・ダウンロードフォルダには触れません。
 */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
let executable, profile, child, spawnError, browserStderr = '', phase = 'browser detection', port, endpointStatus = 'not requested';
const START_TIMEOUT = 15000, CDP_TIMEOUT = 20000;
function findBrowser() {
  if (process.env.ATLAS_BROWSER) return process.env.ATLAS_BROWSER;
  const candidates = process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(root => [path.join(root,'Google/Chrome/Application/chrome.exe'),path.join(root,'Microsoft/Edge/Application/msedge.exe')])
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of (process.platform === 'win32' ? ['chrome.exe','msedge.exe','chromium.exe'] : ['google-chrome','google-chrome-stable','chromium','chromium-browser','microsoft-edge'])) candidates.push(path.join(dir,name));
  }
  // Chrome for Testingの代表的な展開先とPuppeteerの既存キャッシュのみ。ダウンロードはしない。
  for (const root of [__dirname, path.join(os.homedir(),'.cache/puppeteer/chrome')]) {
    for (const name of ['chrome-win64/chrome.exe','chrome-win32/chrome.exe','chrome-linux64/chrome','chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing','chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
      candidates.push(path.join(root,name));
      if (root !== __dirname && fs.existsSync(root)) for (const version of fs.readdirSync(root)) candidates.push(path.join(root,version,name));
    }
  }
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}
function diagnostics(error) {
  console.error(JSON.stringify({ phase, executable: executable ?? null, pid: child?.pid ?? null, port: port ?? 'not assigned', userDataDir: profile ?? null,
    jsonVersion: endpointStatus, startupTimeoutMs: START_TIMEOUT, cdpTimeoutMs: CDP_TIMEOUT, error: error.message, stderr: browserStderr }, null, 2));
}
async function startBrowser() {
  executable = findBrowser();
  if (!executable) throw new Error('Chrome/Edgeが見つかりません。ATLAS_BROWSERを指定してください。');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-smoke-'));
  phase = 'browser process startup';
  child = spawn(executable, ['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
  child.on('error', error => { spawnError = error; });
  child.stderr.on('data', chunk => { browserStderr = (browserStderr + chunk.toString()).slice(-65536); });
  const deadline = Date.now() + START_TIMEOUT;
  let version;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error('Chrome起動失敗: ' + spawnError.message);
    if (child.exitCode !== null || child.signalCode) throw new Error('Chromeがendpoint準備前に終了しました。exit=' + child.exitCode);
    try {
      const active = fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/);
      port = Number(active[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port not ready');
      phase = 'Chrome started; /json/version readiness';
      const response = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(1000) });
      endpointStatus = 'HTTP ' + response.status;
      if (!response.ok) throw new Error(endpointStatus);
      version = await response.json();
      const ws = new URL(version.webSocketDebuggerUrl);
      if (!['127.0.0.1','localhost'].includes(ws.hostname) || Number(ws.port) !== port || ws.pathname !== active[1]) throw new Error('endpoint does not match temporary profile');
      endpointStatus += ' / ' + version.Browser; break;
    } catch (error) { endpointStatus = error.message; }
    await pause(150);
  }
  if (!version?.webSocketDebuggerUrl || !endpointStatus.startsWith('HTTP 200')) throw new Error('Chrome起動後の/json/version準備がタイムアウトしました。');
  console.log('Browser ready: ' + JSON.stringify({ executable, pid:child.pid, port, userDataDir:profile, jsonVersion:endpointStatus }));
  phase = 'Chrome started; CDP WebSocket connection';
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket接続timeout')), START_TIMEOUT);
    socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once:true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket接続失敗')); }, { once:true });
    socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('CDP WebSocket切断')); for(const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP切断')); } pending.clear(); });
  });
}
function handleMessage(event) {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  if (message.method === 'Page.loadEventFired' && message.sessionId === session && loaded) loaded();
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, session, nextId = 1, passed = 0, loaded;
const pending = new Map(), exceptions = [];
function send(method, params = {}, inPage = true, timeout = CDP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    phase = 'Chrome started; CDP ' + method;
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(inPage ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 150; n++) { if (await evaluate(expression)) return; await pause(50); }
  throw new Error(`待機がタイムアウト: ${expression}`);
}
async function check(name, expression) { if (!(await evaluate(expression))) throw new Error(name); console.log('PASS ' + name); passed++; }
async function reload() {
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ページ読込タイムアウト')), 15000);
    loaded = () => { clearTimeout(timer); loaded = null; resolve(); };
  });
  await send('Page.reload'); await ready;
}
async function main() {
  await startBrowser();
  const target = await send('Target.createTarget', { url: 'about:blank' }, false);
  fs.mkdirSync(path.join(profile, 'downloads'));
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(profile, 'downloads') }, false);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, 'index.html')).href });
  await until("!!document.getElementById('nextFilename')?.textContent.includes('.png')");
  await check('file://起動・画像0枚で保存不可', "document.getElementById('exportButton').disabled && document.getElementById('imageCount').textContent === '0'");
  await evaluate(`window.testSet = (name,value) => {const el=document.getElementById('settingsForm').elements.namedItem(name); if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    window.testImport = async () => {
      const dt=new DataTransfer();
      for(const [name,w,h,color,transparent] of [['idle.png',32,48,'#e87550',false],['idle.png',64,80,'#337eae',false],['opaque.png',16,16,'#9870ae',false],['empty.png',10,10,'',true]]) {
        const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
        if(!transparent){ctx.fillStyle=color;if(name==='opaque.png')ctx.fillRect(0,0,w,h);else ctx.fillRect(4,6,w-8,h-12);}
        const blob=await new Promise(resolve=>c.toBlob(resolve));dt.items.add(new File([blob],name,{type:'image/png'}));
      }
      dt.items.add(new File(['invalid'],'broken.png',{type:'image/png'}));
      window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
    }; await testImport();`);
  await until("document.getElementById('imageCount').textContent==='5' && !document.getElementById('exportButton').disabled");
  await check('複数ドロップ・個別デコードエラー・透明画像の除外', "document.querySelectorAll('.image-row.has-error').length===2 && document.getElementById('previewStats').textContent.includes('3 スプライト')");
  await check('重複名の一意化・不透明の案内', "document.querySelectorAll('.sprite-name')[1].textContent==='idle_2' && document.getElementById('imageList').textContent.includes('全面不透明')");
  await evaluate("document.querySelectorAll('.image-row')[1].querySelector('[data-action=up]').click()");
  await check('並び替え', "document.querySelector('.sprite-name').textContent==='idle_2'");
  await evaluate("document.querySelector('.image-row').click();const input=document.getElementById('spriteName');input.value='idle';input.dispatchEvent(new Event('change',{bubbles:true}));testSet('scaleMode','uniform');document.getElementById('bottomAlign').click();");
  await until("!document.getElementById('exportButton').disabled");
  await check('名前変更の重複回避・下中央ショートカット', "document.querySelector('.sprite-name').textContent==='idle_2' && document.getElementById('alignment').value==='bottom-center'");
  await evaluate("testSet('padding',64)"); await until("!document.getElementById('validation').hidden");
  await check('描画領域0の設定は書出不可', "document.getElementById('exportButton').disabled");
  await evaluate("testSet('padding',8);testSet('threshold',255)"); await until("document.getElementById('validation').textContent.includes('出力できる画像')");
  await check('しきい値変更で画像ごとのエラーを更新', "document.querySelectorAll('.image-row.has-error').length===5");
  await evaluate("testSet('threshold',1);testSet('columns',3);testSet('pot',true)"); await until("!document.getElementById('exportButton').disabled");
  await evaluate("document.getElementById('exportButton').click()"); await until("!document.getElementById('downloadPanel').hidden");
  await evaluate("window.savedJSON=await (await fetch(document.getElementById('downloadJson').href)).json();window.savedPNG=await createImageBitmap(await (await fetch(document.getElementById('downloadPng').href)).blob());");
  await check('保存PNGの実サイズ・JSON一致・Uniform共通倍率・順序', "savedPNG.width===512 && savedPNG.height===128 && savedJSON.meta.atlasWidth===512 && savedJSON.sprites.length===3 && savedJSON.sprites.every(s=>s.scale===savedJSON.sprites[0].scale) && savedJSON.sprites[0].name==='idle_2'");
  const downloadName = await evaluate("document.getElementById('downloadPng').download.replace(/\\.png$/,'')");
  await evaluate("document.getElementById('downloadPng').click();document.getElementById('downloadJson').click();");
  const pngPath = path.join(profile, 'downloads', downloadName + '.png'), jsonPath = path.join(profile, 'downloads', downloadName + '.json');
  for (let n = 0; n < 100 && (!fs.existsSync(pngPath) || !fs.existsSync(jsonPath)); n++) await pause(50);
  const pngBytes = fs.readFileSync(pngPath), diskJSON = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (pngBytes.readUInt32BE(16) !== 512 || pngBytes.readUInt32BE(20) !== 128 || diskJSON.meta.image !== downloadName + '.png') throw new Error('保存済みPNG/JSON不一致');
  console.log('PASS 一時フォルダへのPNG・JSON実ダウンロード'); passed++;
  await evaluate("document.getElementById('confirmDownloads').click();");
  await check('保存完了操作後に連番が進む', "document.getElementById('nextFilename').textContent.includes('_0001.png')");
  await evaluate("window.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};document.getElementById('exportButton').click();");
  await until("document.getElementById('notice').textContent.includes('PNG生成に失敗')");
  await check('PNG生成失敗を表示・連番を更新しない', "document.getElementById('nextFilename').textContent.includes('_0001.png') && !document.getElementById('exportButton').disabled");
  await evaluate("HTMLCanvasElement.prototype.toBlob=originalToBlob;window.originalStringify=JSON.stringify;JSON.stringify=function(value,...rest){if(value?.meta?.image)throw new Error('テスト用JSON生成失敗');return originalStringify(value,...rest);};document.getElementById('exportButton').click();");
  await until("document.getElementById('notice').textContent.includes('JSON生成に失敗')");
  await check('JSON生成失敗を表示・再試行可能', "document.getElementById('nextFilename').textContent.includes('_0001.png') && !document.getElementById('exportButton').disabled");
  await evaluate("JSON.stringify=originalStringify;document.getElementById('exportButton').click();"); await until("!document.getElementById('downloadPanel').hidden");
  await evaluate("document.getElementById('cancelDownloads').click();document.querySelector('.image-row.has-error [data-action=delete]').click();");
  await check('画像削除', "document.getElementById('imageCount').textContent==='4'");
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  if (process.env.ATLAS_SCREENSHOT) fs.writeFileSync(path.resolve(process.env.ATLAS_SCREENSHOT), Buffer.from(screenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await pause(100);
  const overflow = await evaluate('Array.from(document.querySelectorAll("body *")).filter(e=>e.getBoundingClientRect().right>390).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right}))');
  if (overflow.length) console.log('Overflow: ' + JSON.stringify(overflow));
  await check('狭幅レイアウトでページ横方向にあふれない', 'document.documentElement.scrollWidth<=390');
  await evaluate(`const pasteData=new DataTransfer();pasteData.items.add(new File([await (await fetch(document.querySelector('.thumbnail img').src)).blob()],'pasted.png',{type:'image/png'}));window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:pasteData,bubbles:true,cancelable:true}));`);
  await until("document.getElementById('imageCount').textContent==='5' && !document.getElementById('exportButton').disabled");
  await check('クリップボード画像の追加', "document.getElementById('imageList').textContent.includes('pasted.png')");
  await evaluate(`const fileData=new DataTransfer();fileData.items.add(new File([await (await fetch(document.querySelector('.thumbnail img').src)).blob()],'selected.png',{type:'image/png'}));document.getElementById('fileInput').files=fileData.files;document.getElementById('fileInput').dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.getElementById('imageCount').textContent==='6' && !document.getElementById('exportButton').disabled");
  await check('ファイル選択入力の追加', "document.getElementById('imageList').textContent.includes('selected.png') && document.getElementById('fileInput').value===''");
  await check('通常追加の全Spriteに共通XY入力・初期値0', "Array.from(document.querySelectorAll('.image-row')).every(row=>{document.querySelector('[data-id=\"'+row.dataset.id+'\"]').click();return document.getElementById('offsetX').value==='0' && document.getElementById('offsetY').value==='0';})");
  await evaluate(`document.querySelector('.image-row').click();window.normalBefore=document.getElementById('atlasCanvas').toDataURL();const normalOffset=document.querySelector('input[data-action=offsetX]');normalOffset.value='-3';normalOffset.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('button[data-action=offsetY]').click();`);
  await check('通常追加のXY補正がプレビューへ即時反映', "window.normalBefore!==document.getElementById('atlasCanvas').toDataURL()");
  await evaluate("document.getElementById('exportButton').click()");
  await until("!document.getElementById('downloadPanel').hidden");
  await check('通常追加のXY補正をJSON出力', "(await (await fetch(document.getElementById('downloadJson').href)).json()).sprites.every((s,i)=>i===0 ? s.offsetX===-3 && s.offsetY===-1 && !s.anchor : s.offsetX===0 && s.offsetY===0)");
  await evaluate("document.getElementById('cancelDownloads').click()");
  await reload();
  await check('再起動後に設定復元・画像は保存しない', "document.getElementById('settingsForm').elements.scaleMode.value==='uniform' && document.getElementById('alignment').value==='bottom-center' && document.getElementById('imageCount').textContent==='0'");
  await evaluate(`window.splitTest = async (count) => {
    const c=document.createElement('canvas');c.width=100;c.height=12;const ctx=c.getContext('2d');ctx.fillStyle='red';
    for(let i=0;i<count;i++)ctx.fillRect(i*11,0,10,10);
    const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'hero.png',{type:'image/png'}));
    const input=document.getElementById('splitInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  }; await splitTest(3);`);
  await until("document.getElementById('imageCount').textContent==='3' && !document.getElementById('exportButton').disabled");
  await check('分割追加・連番・検出数表示', "Array.from(document.querySelectorAll('.sprite-name')).map(i=>i.textContent).join(',')==='hero_01,hero_02,hero_03' && document.getElementById('notice').textContent.includes('3キャラクター')");
  await check('分割追加の全Spriteに共通XY入力・初期値0', "Array.from(document.querySelectorAll('.image-row')).every(row=>{document.querySelector('[data-id=\"'+row.dataset.id+'\"]').click();return document.getElementById('offsetX').value==='0' && document.getElementById('offsetY').value==='0';})");
  await evaluate(`document.querySelector('.image-row').click();window.beforeOffset=document.getElementById('atlasCanvas').toDataURL();const offset=document.querySelector('input[data-action=offsetX]');offset.value='-3';offset.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('button[data-action=offsetY]').click();`);
  await check('offset変更がプレビューへ即時反映', "window.beforeOffset!==document.getElementById('atlasCanvas').toDataURL()");
  await evaluate("document.getElementById('exportButton').click()");
  await until("!document.getElementById('downloadPanel').hidden");
  await check('数値入力と1px補正を出力JSONへ反映', "(await (await fetch(document.getElementById('downloadJson').href)).json()).sprites.every((s,i)=>i!==0 || (s.offsetX===-3 && s.offsetY===-1 && s.placement==='centroid-bottom'))");
  await evaluate("document.getElementById('cancelDownloads').click();splitTest(9)");
  await until("document.getElementById('notice').textContent.includes('9個以上')");
  await check('9島拒否時は既存画像を維持', "document.getElementById('imageCount').textContent==='3'");
  await evaluate("splitTest(0)");
  await until("document.getElementById('notice').textContent.includes('0キャラクター')");
  await check('透明PNGは0件を案内', "document.getElementById('imageCount').textContent==='3'");
  await send('Emulation.setDeviceMetricsOverride', { width:1920,height:1080,deviceScaleFactor:1,mobile:false });
  await evaluate(`window.editSprite=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    window.selectSprite=index=>document.querySelectorAll('.image-row')[index].click();
    selectSprite(0);editSprite('groupId',' walk ');editSprite('animationOrder',2);editSprite('durationFrames',3);editSprite('groupFps',60);
    selectSprite(1);editSprite('groupId','walk');editSprite('animationOrder',0);editSprite('durationFrames',6);
  `);
  await check('Group共有FPSとSprite属性・選択状態', "document.getElementById('groupFps').value==='60' && document.querySelectorAll('.image-row.selected').length===1 && document.querySelectorAll('.animation-summary')[0].textContent.includes('Order: 2')");
  await check('FHD3ペイン・ページ固定高さ・独立スクロール', "document.documentElement.scrollHeight<=1080 && document.querySelector('.settings').getBoundingClientRect().width>=280 && document.querySelector('.settings').getBoundingClientRect().width<=300 && document.querySelector('.inspector').getBoundingClientRect().left>document.querySelector('.main-column').getBoundingClientRect().right && ['.settings','.inspector','.image-list','#previewViewport'].every(s=>getComputedStyle(document.querySelector(s)).overflowY==='auto')");
  await evaluate("document.getElementById('exportButton').click()"); await until("!document.getElementById('downloadPanel').hidden");
  await evaluate("window.animationJSON=await (await fetch(document.getElementById('downloadJson').href)).json()");
  await check('JSON version2・Animation順とAtlas index・duration', "animationJSON.meta.version===2 && JSON.stringify(animationJSON.animations.walk)==='{\"fps\":60,\"frames\":[{\"sprite\":1,\"duration\":6},{\"sprite\":0,\"duration\":3}]}'");
  await evaluate(`window.previewMatches=(id,index)=>{const s=animationJSON.sprites[index], atlas=document.getElementById('atlasCanvas'), c=document.getElementById(id);const expected=atlas.getContext('2d').getImageData(s.x,s.y,s.width,s.height).data;return c.width===s.width && c.height===s.height && c.getContext('2d').getImageData(0,0,c.width,c.height).data.every((v,i)=>v===expected[i]);};`);
  await check('選択SpriteとAnimation Previewの画素はAtlasセルと一致', "previewMatches('selectedCanvas',1) && previewMatches('animationCanvas',1)");
  await evaluate("document.getElementById('cancelDownloads').click();editSprite('offsetX',4)");
  await check('offset変更が選択/Animation Previewへ即時反映', "previewMatches('selectedCanvas',1) && previewMatches('animationCanvas',1)");
  await evaluate("editSprite('groupFps',10);document.getElementById('loopAnimation').checked=false;document.getElementById('playAnimation').click()");
  await until("document.getElementById('animationCanvas').dataset.spriteIndex==='0'");
  await check('requestAnimationFrameによる時間ベースの遷移', "document.getElementById('animationFrameInfo').textContent.includes('Order 2') && previewMatches('animationCanvas',0)");
  await until("document.getElementById('stopAnimation').disabled");
  await check('非ループ再生の終端で停止し最終フレームを保持', "!document.getElementById('playAnimation').disabled && document.getElementById('animationCanvas').dataset.spriteIndex==='0'");
  await evaluate("document.getElementById('loopAnimation').checked=true;document.getElementById('playAnimation').click()");
  await until("document.getElementById('animationCanvas').dataset.spriteIndex==='0'");
  await until("document.getElementById('animationCanvas').dataset.spriteIndex==='1'");
  await check('ループで先頭へ戻り再生を継続', "!document.getElementById('stopAnimation').disabled");
  await evaluate("document.getElementById('stopAnimation').click();editSprite('groupFps',24);selectSprite(0)");
  await check('FPS編集がGroup全体へ即時反映・停止操作', "document.getElementById('groupFps').value==='24' && document.getElementById('animationInfo').textContent.includes('24 FPS') && document.getElementById('stopAnimation').disabled");
  await evaluate("editSprite('groupFps',0)");
  await check('不正Animation設定は出力/再生を禁止', "document.getElementById('exportButton').disabled && document.getElementById('playAnimation').disabled && document.getElementById('validation').textContent.includes('FPS')");
  await evaluate("editSprite('groupFps',24);document.querySelector('.image-row.selected [data-action=delete]').click()");
  await check('選択Sprite削除後の安全な再選択', "!document.getElementById('inspectorContent').hidden && document.getElementById('spriteName').value==='hero_02' && document.querySelectorAll('.image-row.selected').length===1");
  if (process.env.ATLAS_SCREENSHOT) { const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(process.env.ATLAS_SCREENSHOT),Buffer.from(shot.data,'base64')); }
  await evaluate("document.getElementById('clearImages').click()");
  await check('全削除時にInspector Empty State・再生停止', "!document.getElementById('inspectorEmpty').hidden && document.getElementById('playAnimation').disabled && document.getElementById('selectedCanvas').width===1");
  await evaluate("localStorage.setItem('sprite-atlas.settings.v1','{broken')");
  await reload();
  await check('壊れた保存JSONで初期値へ復帰', "document.getElementById('settingsForm').elements.scaleMode.value==='individual' && document.getElementById('notice').textContent.includes('初期値')");
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Storage.prototype.getItem=function(){throw new Error('storage blocked');};Storage.prototype.setItem=function(){throw new Error('storage blocked');};" });
  await reload();
  await check('localStorage利用不可でも起動・警告', "document.getElementById('nextFilename').textContent.includes('_0000.png') && document.getElementById('notice').classList.contains('warning')");
  await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, 'tests.html')).href });
  await until("!!document.body?.dataset.testStatus");
  if (!(await evaluate("document.body.dataset.testStatus==='passed'"))) throw new Error('Canvas/PNGテスト失敗');
  console.log('PASS Canvas / PNG / core tests: ' + await evaluate("document.getElementById('testSummary').textContent"));
  if (exceptions.length) throw new Error(JSON.stringify(exceptions));
  console.log(`${passed}/${passed} browser smoke checks passed; no uncaught exceptions`);
  if (process.env.ATLAS_SCREENSHOT) console.log('Screenshot: ' + path.resolve(process.env.ATLAS_SCREENSHOT));
}
let cleanupPromise;
function cleanup() {
  return cleanupPromise ??= (async () => {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, false, 2000); } catch {} socket.close(); }
    else if (socket) socket.close();
    if (child?.pid && child.exitCode === null && !child.signalCode) {
      for (let n=0;n<20 && child.exitCode===null && !child.signalCode;n++) await pause(100);
      if (child.exitCode===null && !child.signalCode) child.kill();
      for (let n=0;n<30 && child.exitCode===null && !child.signalCode;n++) await pause(100);
    }
    if (profile && fs.existsSync(profile)) {
      const root = fs.realpathSync(os.tmpdir()), target = fs.realpathSync(profile);
      if (path.dirname(target) !== root || !path.basename(target).startsWith('atlas-smoke-')) throw new Error('一時プロファイルの削除範囲を確認できません。');
      await fs.promises.rm(target, { recursive:true, force:true, maxRetries:10, retryDelay:200 });
      console.log('Temporary profile removed: ' + target);
    }
  })();
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { process.exitCode=1; cleanup().catch(console.error); });
main().catch(error => { diagnostics(error); process.exitCode=1; }).finally(() => cleanup().catch(error => { console.error('Cleanup failed: ' + error.message); process.exitCode=1; }));
