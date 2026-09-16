/* 任意の開発用テスト。Node 22以降とインストール済みChromeのみ（npm不要）。
 * 一時プロファイルでfile://のアプリを操作。ダウンロード先も一時フォルダ。
 * 実ユーザーの設定・ダウンロードフォルダには触れません。
 */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const executable = process.env.ATLAS_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-smoke-'));
const child = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, session, nextId = 1, passed = 0, loaded;
const pending = new Map(), exceptions = [];
function send(method, params = {}, inPage = true) {
  return new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
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
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome起動がタイムアウトしました。')), 15000);
    child.once('error', reject); child.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match && !socket) { socket = new WebSocket(match[1]); socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }); }
    });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Page.loadEventFired' && message.sessionId === session && loaded) loaded();
  });
  const target = await send('Target.createTarget', { url: 'about:blank' }, false);
  fs.mkdirSync(path.join(profile, 'downloads'));
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(profile, 'downloads') }, false);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
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
  await check('重複名の一意化・不透明の案内', "document.querySelectorAll('.image-detail input')[1].value==='idle_2' && document.getElementById('imageList').textContent.includes('全面不透明')");
  await evaluate("document.querySelectorAll('.image-row')[1].querySelector('[data-action=up]').click()");
  await check('並び替え', "document.querySelector('.image-detail input').value==='idle_2'");
  await evaluate("const input=document.querySelector('.image-detail input');input.value='idle';input.dispatchEvent(new Event('change',{bubbles:true}));testSet('scaleMode','uniform');document.getElementById('bottomAlign').click();");
  await until("!document.getElementById('exportButton').disabled");
  await check('名前変更の重複回避・下中央ショートカット', "document.querySelector('.image-detail input').value==='idle_2' && document.getElementById('alignment').value==='bottom-center'");
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
  fs.writeFileSync(path.join(profile, 'desktop.png'), Buffer.from(screenshot.data, 'base64'));
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
  await reload();
  await check('再起動後に設定復元・画像は保存しない', "document.getElementById('settingsForm').elements.scaleMode.value==='uniform' && document.getElementById('alignment').value==='bottom-center' && document.getElementById('imageCount').textContent==='0'");
  await evaluate("localStorage.setItem('sprite-atlas.settings.v1','{broken')");
  await reload();
  await check('壊れた保存JSONで初期値へ復帰', "document.getElementById('settingsForm').elements.scaleMode.value==='individual' && document.getElementById('notice').textContent.includes('初期値')");
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Storage.prototype.getItem=function(){throw new Error('storage blocked');};Storage.prototype.setItem=function(){throw new Error('storage blocked');};" });
  await reload();
  await check('localStorage利用不可でも起動・警告', "document.getElementById('nextFilename').textContent.includes('_0000.png') && document.getElementById('notice').classList.contains('warning')");
  await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, 'tests.html')).href });
  await until("!!document.body?.dataset.testStatus");
  if (!(await evaluate("document.body.dataset.testStatus==='passed' && document.getElementById('testSummary').textContent==='27 / 27 成功'"))) throw new Error('Canvas/PNGテスト失敗');
  console.log('PASS Canvas / PNG / core tests: 27/27');
  if (exceptions.length) throw new Error(JSON.stringify(exceptions));
  console.log(`${passed}/${passed} browser smoke checks passed; no uncaught exceptions`);
  console.log('Screenshot: ' + path.join(profile, 'desktop.png'));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, false); } catch {} socket.close(); }
  child.kill();
});
