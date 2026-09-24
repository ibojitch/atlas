/* 任意の開発用テスト。Node 22以降とインストール済みChromeのみ（npm不要）。
 * 一時プロファイルでfile://のアプリを操作。ダウンロード先も一時フォルダ。
 * 実ユーザーの設定・ダウンロードフォルダには触れません。
 */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
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
  if (message.method === 'Page.javascriptDialogOpening' && message.sessionId === session) {
    const accept = nextDialogAccept; nextDialogAccept = true;
    send('Page.handleJavaScriptDialog', { accept }).catch(error => exceptions.push({ text: error.message }));
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, session, nextId = 1, passed = 0, loaded, nextDialogAccept = true;
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
  await check('file://起動・画像0枚で保存不可・dirty=falseは変更なし', "document.getElementById('exportButton').disabled && document.getElementById('imageCount').textContent === '0' && document.getElementById('atlasSaveState').textContent==='変更なし' && document.getElementById('lineSaveState').textContent==='変更なし'");
  await check('Sprite未選択時は反転コピー不可', "document.getElementById('flipHorizontalCopy').disabled && document.getElementById('flipVerticalCopy').disabled");
  await evaluate(`window.thumbPixels=async index=>{const img=document.querySelectorAll('.thumbnail img')[index],bitmap=await createImageBitmap(await(await fetch(img.src)).blob()),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);};
    const c=document.createElement('canvas');c.width=3;c.height=2;const ctx=c.getContext('2d');
    for(const [x,y,color] of [[0,0,'#ff0000'],[1,0,'#00ff00'],[2,0,'#0000ff'],[0,1,'#ffff00'],[1,1,'#ff00ff'],[2,1,'#00ffff']]){ctx.fillStyle=color;ctx.fillRect(x,y,1,1);}
    const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'asymmetric.png',{type:'image/png'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));`);
  await until("document.getElementById('imageCount').textContent==='1' && !document.getElementById('flipHorizontalCopy').disabled");
  await check('Atlas編集でAtlas dirtyのみtrue', "WorkspaceShell.state.atlas.dirty && !WorkspaceShell.state.line.dirty && document.getElementById('atlasSaveState').textContent.includes('未保存')");
  await evaluate("document.getElementById('workspace-line').click()");
  await check('Atlas→LINEでAtlas stateとdirtyを維持', "document.getElementById('atlasWorkspace').hidden && !document.getElementById('lineWorkspace').hidden && document.getElementById('imageCount').textContent==='1' && WorkspaceShell.state.atlas.dirty");
  await evaluate("const ignored=new DataTransfer();ignored.items.add(new File(['ignored'],'line-drop.png',{type:'image/png'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:ignored,bubbles:true,cancelable:true}));window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:ignored,bubbles:true,cancelable:true}))");
  await check('LINE表示中のdrop/pasteは隠れたAtlasへ追加しない', "document.getElementById('imageCount').textContent==='1'");
  await check('Static予定数とPhase 2仕様を表示', "Array.from(document.getElementById('lineStickerCount').options).map(o=>o.value).join(',')==='8,16,24,32,40' && document.getElementById('lineStickerSpec').textContent.includes('370 × 320') && document.querySelectorAll('.line-slot').length===8 && !document.getElementById('lineStaticTools').hidden");
  await evaluate("document.getElementById('lineStickerCount').value='40';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineType').value='animated';document.getElementById('lineType').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('UIでもStatic 40→Animated 24へ丸めslot番号を維持', "document.getElementById('lineStickerCount').value==='24' && document.querySelectorAll('.line-slot').length===24 && document.querySelector('.line-slot').dataset.slot==='1' && document.querySelector('.line-slot:last-child').dataset.slot==='24'");
  await evaluate("document.getElementById('lineType').value='static';document.getElementById('lineType').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineStickerCount').value='8';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}))");
  await evaluate("document.getElementById('lineStickerCount').value='16';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('LINE編集でLINE dirty・Atlas dirtyは独立維持', "WorkspaceShell.state.line.dirty && WorkspaceShell.state.atlas.dirty && document.querySelectorAll('.line-slot').length===16");
  await evaluate("document.getElementById('lineType').value='animated';document.getElementById('lineType').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineStickerCount').value='24';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('Animatedは8/16/24・APNG未実装を表示', "Array.from(document.getElementById('lineStickerCount').options).map(o=>o.value).join(',')==='8,16,24' && document.getElementById('lineStickerSpec').textContent.includes('320 × 270') && !document.getElementById('lineApngStatus').hidden");
  await evaluate("document.getElementById('linePrepareProject').click()");
  await until("!document.getElementById('lineSaveProject').hidden");
  await evaluate("window.lineSaved=await(await fetch(document.getElementById('lineSaveProject').href)).json()");
  await check('LINE Project生成だけではdirtyを解除しない', "lineSaved.type==='animated' && lineSaved.targetStickerCount===24 && WorkspaceShell.state.line.dirty && document.getElementById('lineConfirmSave').disabled");
  await evaluate("document.getElementById('lineSaveProject').click();document.getElementById('lineConfirmSave').click()");
  await check('LINE保存完了確認後dirty=false', "!WorkspaceShell.state.line.dirty && WorkspaceShell.state.atlas.dirty");
  await evaluate("document.getElementById('lineStickerCount').value='16';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}));window.lineBeforeFailure=JSON.stringify({type:document.getElementById('lineType').value,count:document.getElementById('lineStickerCount').value,dirty:WorkspaceShell.state.line.dirty});window.loadLineText=text=>{const dt=new DataTransfer();dt.items.add(new File([text],'line-project.json',{type:'application/json'}));const input=document.getElementById('lineProjectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));};loadLineText('{broken')");
  await until("document.getElementById('lineNotice').textContent.includes('現在の編集内容は維持')");
  await check('malformed LINE Projectはstateとdirtyをatomic維持', "JSON.stringify({type:document.getElementById('lineType').value,count:document.getElementById('lineStickerCount').value,dirty:WorkspaceShell.state.line.dirty})===lineBeforeFailure");
  await evaluate("loadLineText(JSON.stringify({format:'line-stamp-project',version:1,type:'static',targetStickerCount:40,mainImage:null,tabImage:null,stickers:[]}))");
  await until("document.getElementById('lineNotice').textContent.includes('40個のLINE Project')");
  await check('LINE Project LOAD成功後dirty=false・type/count復元', "document.getElementById('lineType').value==='static' && document.getElementById('lineStickerCount').value==='40' && !WorkspaceShell.state.line.dirty");
  await evaluate("document.getElementById('lineNewProject').click()");
  await evaluate(`window.addLineSet=async()=>{const dt=new DataTransfer();for(let n=1;n<=8;n++){const c=document.createElement('canvas');c.width=80+n;c.height=60+n;const x=5+n%3,y=4+n%2,ctx=c.getContext('2d');ctx.fillStyle='hsl('+n*40+' 80% 50%)';if(n===1)ctx.globalAlpha=.5;ctx.fillRect(x,y,50,40);dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'stamp-'+n+'.png',{type:'image/png'}));}const input=document.getElementById('lineImageInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));};await addLineSet();`);
  await until("document.querySelectorAll('.line-slot.filled').length===8 && !document.getElementById('lineInspectorContent').hidden");
  await check('Static複数画像読込・元画像寸法・自動trim preview', "document.getElementById('lineProjectSummary').textContent.includes('Sticker: 8 / 8') && document.querySelector('.line-slot[data-slot=\"1\"] small').textContent==='stamp-1.png' && document.getElementById('linePreviewInfo').textContent.includes('元 88×68') && document.getElementById('linePreviewCanvas').width%2===0 && document.getElementById('linePreviewCanvas').width<=370");
  await evaluate("document.querySelector('.line-slot[data-slot=\"1\"]').click();document.getElementById('lineOffsetX').value='3';document.getElementById('lineOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineOffsetY').value='-2';document.getElementById('lineOffsetY').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('正常なSticker offset編集はrender後もstateへ保持', "document.getElementById('lineOffsetX').value==='3' && document.getElementById('lineOffsetY').value==='-2' && !document.getElementById('lineInspectorContent').hidden");
  await evaluate("document.getElementById('linePrepareProject').click()");await until("!document.getElementById('lineSaveProject').hidden");await evaluate("window.lineInitialY=await(await fetch(document.getElementById('lineSaveProject').href)).json()");
  await check('LINE Sticker UI -2入力は従来どおりinternal +2', "lineInitialY.stickers.find(s=>s.slot===1).edit.offsetY===2 && document.getElementById('lineOffsetY').getAttribute('aria-label').includes('+は上方向')");
  await evaluate("document.getElementById('lineOffsetX').value='1.5';document.getElementById('lineOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineOffsetX').value='1001';document.getElementById('lineOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineScale').value='10';document.getElementById('lineScale').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('不正なSticker入力だけをrejectし直前値へ戻す', "document.getElementById('lineOffsetX').value==='3' && document.getElementById('lineScale').value==='1' && document.getElementById('lineNotice').classList.contains('error')");
  await evaluate("document.getElementById('lineScale').value='1.1';document.getElementById('lineScale').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('linePrepareProject').click()");await until("!document.getElementById('lineSaveProject').hidden");await evaluate("window.lineOversize=await(await fetch(document.getElementById('lineSaveProject').href)).json()");
  await check('Sticker描画範囲超過は値を保持し出力だけ禁止', "lineOversize.stickers.find(s=>s.slot===1).edit.scale===1.1 && document.getElementById('lineValidation').textContent.includes('370 × 320px') && document.getElementById('linePrepareOutput').disabled && !document.getElementById('lineScale').disabled && !document.getElementById('lineOffsetX').disabled");
  await evaluate("document.getElementById('lineScale').value='1';document.getElementById('lineScale').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineThreshold').value='254';document.getElementById('lineThreshold').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('有効画素なしでもthreshold値とInspector操作を維持', "document.getElementById('lineThreshold').value==='254' && document.getElementById('lineValidation').textContent.includes('有効な画素がありません') && document.getElementById('linePrepareOutput').disabled && !document.getElementById('lineThreshold').disabled");
  await evaluate("document.getElementById('lineThreshold').value='1';document.getElementById('lineThreshold').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineUseMain').click();document.getElementById('lineUseTab').click();document.getElementById('lineOffsetY').value='4';document.getElementById('lineOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineMainOffsetY').value='4';document.getElementById('lineMainOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineTabOffsetY').value='-4';document.getElementById('lineTabOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('linePrepareProject').click()");await until("!document.getElementById('lineSaveProject').hidden");await evaluate("window.lineAllY=await(await fetch(document.getElementById('lineSaveProject').href)).json()");
  await check('LINE Sticker / Main / TabのY入力はすべてUI符号を反転して保存', "lineAllY.stickers.find(s=>s.slot===1).edit.offsetY===-4 && lineAllY.mainImage.offsetY===-4 && lineAllY.tabImage.offsetY===4 && document.getElementById('lineOffsetY').value==='4' && document.getElementById('lineMainOffsetY').value==='4' && document.getElementById('lineTabOffsetY').value==='-4'");
  await evaluate("document.getElementById('lineOffsetY').value='-4';document.getElementById('lineOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('linePrepareProject').click()");await until("!document.getElementById('lineSaveProject').hidden");await evaluate("window.lineNegativeY=await(await fetch(document.getElementById('lineSaveProject').href)).json()");
  await check('LINE Sticker UI -4入力はinternal +4', "lineNegativeY.stickers.find(s=>s.slot===1).edit.offsetY===4");
  await evaluate("document.getElementById('lineOffsetY').value='-2';document.getElementById('lineOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineMainOffsetY').value='0';document.getElementById('lineMainOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineTabOffsetY').value='0';document.getElementById('lineTabOffsetY').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineMainOffsetX').value='1';document.getElementById('lineMainOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineOffsetX').value='4';document.getElementById('lineOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('linePrepareProject').click()");await until("!document.getElementById('lineSaveProject').hidden");await evaluate("window.lineOtherError=await(await fetch(document.getElementById('lineSaveProject').href)).json()");
  await check('Main描画エラーでもSticker編集をrollbackしない', "lineOtherError.mainImage.offsetX===1 && lineOtherError.stickers.find(s=>s.slot===1).edit.offsetX===4 && document.getElementById('lineValidation').textContent.includes('Main Image') && !document.getElementById('lineOffsetX').disabled && !document.getElementById('lineMainOffsetX').disabled");
  await evaluate("document.getElementById('lineMainOffsetX').value='1.5';document.getElementById('lineMainOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineMainOffsetX').value='1001';document.getElementById('lineMainOffsetX').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('Main不正入力だけをrejectして合法な描画エラー値を維持', "document.getElementById('lineMainOffsetX').value==='1' && document.getElementById('lineValidation').textContent.includes('Main Image')");
  await evaluate("document.getElementById('lineMainOffsetX').value='0';document.getElementById('lineMainOffsetX').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineMoveDown').click()");
  await check('offset・並べ替え・安定IDのMain/Tab参照・dirty独立', "document.querySelector('.line-slot[data-slot=\"2\"] small').textContent==='stamp-1.png' && document.getElementById('lineMainStatus').textContent.includes('02 stamp-1.png') && document.getElementById('lineTabStatus').textContent.includes('02 stamp-1.png') && WorkspaceShell.state.line.dirty && WorkspaceShell.state.atlas.dirty");
  await evaluate("document.getElementById('linePrepareOutput').click()");
  await until("document.getElementById('lineDownloads').querySelectorAll('a').length===11");
  await check('Main/Tab/8 Sticker/ZIP生成・公式名・寸法', "Array.from(document.getElementById('lineDownloads').querySelectorAll('a')).map(a=>a.download).join(',')==='main.png,tab.png,01.png,02.png,03.png,04.png,05.png,06.png,07.png,08.png,line-static-stickers.zip' && document.getElementById('lineMainCanvas').width===240 && document.getElementById('lineMainCanvas').height===240 && document.getElementById('lineTabCanvas').width===96 && document.getElementById('lineTabCanvas').height===74");
  await evaluate("window.lineZipBytes=new Uint8Array(await(await fetch(Array.from(document.getElementById('lineDownloads').querySelectorAll('a')).at(-1).href)).arrayBuffer());window.lineZipFiles=ZipWriter.inspect(lineZipBytes);Array.from(document.getElementById('lineDownloads').querySelectorAll('a')).at(-1).click()");
  await check('ZIP STORE CRC・格納PNG bytes・root filenames一致', "lineZipFiles.length===10 && lineZipFiles.map(f=>f.name).join(',')==='main.png,tab.png,01.png,02.png,03.png,04.png,05.png,06.png,07.png,08.png' && lineZipFiles.every(f=>LineImageCore.parsePng(f.data).width>0)");
  for(let n=0;n<100&&!fs.existsSync(path.join(profile,'downloads','line-static-stickers.zip'));n++)await pause(50);
  const zipPath=path.join(profile,'downloads','line-static-stickers.zip'),expandPath=path.join(profile,'expanded-line-zip');
  if(process.platform==='win32'){
    fs.mkdirSync(expandPath);phase='Windows standard tar ZIP validation';const expanded=spawnSync('tar.exe',['-xf',zipPath,'-C',expandPath],{windowsHide:true,encoding:'utf8'});
    if(expanded.status!==0)throw new Error('Windows標準tar ZIP展開失敗: '+expanded.stderr);
    if(fs.readdirSync(expandPath).sort().join(',')!==['01.png','02.png','03.png','04.png','05.png','06.png','07.png','08.png','main.png','tab.png'].sort().join(','))throw new Error('Windows展開後ファイル名が不正');
    console.log('PASS Windows標準tarでZIP展開');passed++;
  }
  await evaluate("document.getElementById('linePrepareProject').click()");await until("!document.getElementById('lineSaveProject').hidden");await evaluate("window.lineV2=await(await fetch(document.getElementById('lineSaveProject').href)).json();window.lineV2Signature=JSON.stringify(lineV2);loadLineText(JSON.stringify(lineV2))");await until("document.getElementById('lineNotice').textContent.includes('8個のLINE Project')");await evaluate("document.querySelector('.line-slot[data-slot=\"2\"]').click()");
  await check('LINE Project SAVE→LOADはinternal offsetYを維持しUIだけ反転', "lineV2.version===2 && lineV2.stickers.length===8 && lineV2.stickers.find(s=>s.source.name==='stamp-1.png').slot===2 && lineV2.stickers.find(s=>s.source.name==='stamp-1.png').edit.offsetX===4 && lineV2.stickers.find(s=>s.source.name==='stamp-1.png').edit.offsetY===2 && document.getElementById('lineOffsetY').value==='-2' && lineV2.mainImage.sourceStickerId===lineV2.tabImage.sourceStickerId && document.getElementById('lineMainStatus').textContent.includes('stamp-1.png') && !WorkspaceShell.state.line.dirty");
  await evaluate("const p=structuredClone(lineV2);p.stickers.find(s=>s.slot===1).edit.scale=1.1;document.getElementById('lineNotice').textContent='';loadLineText(JSON.stringify(p))");await until("document.getElementById('lineNotice').textContent.includes('8個のLINE Project')");
  await check('合法だが描画不能なProjectもLOADして値を保持', "document.getElementById('lineScale').value==='1.1' && !WorkspaceShell.state.line.dirty");
  await check('LOADした描画不能Projectはエラー表示・出力禁止・編集可能', "document.getElementById('lineValidation').textContent.includes('370 × 320px') && document.getElementById('linePrepareOutput').disabled && !document.getElementById('lineScale').disabled");
  await evaluate("document.getElementById('lineScale').value='1';document.getElementById('lineScale').dispatchEvent(new Event('change',{bubbles:true}))");
  await check('LOADした描画不能Projectは正常値へ戻すと復帰', "document.getElementById('lineScale').value==='1' && !document.getElementById('lineValidation').textContent.includes('370 × 320px') && !document.getElementById('linePrepareOutput').disabled && WorkspaceShell.state.line.dirty");
  await evaluate("const p=structuredClone(lineV2);p.stickers[0].source.data='data:image/png;base64,broken';window.lineAtomicBefore=document.getElementById('lineProjectSummary').textContent;loadLineText(JSON.stringify(p))");await until("document.getElementById('lineNotice').textContent.includes('現在の編集内容は維持')");
  await check('壊れたv2埋込画像もstateとdirtyをatomic維持', "document.getElementById('lineProjectSummary').textContent===lineAtomicBefore && WorkspaceShell.state.line.dirty");
  await evaluate("document.getElementById('lineStickerCount').value='32';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}))");
  nextDialogAccept = false; await evaluate("document.getElementById('lineNewProject').click()");
  await check('dirtyなLINE新規作成のキャンセルは状態を変更しない', "document.getElementById('lineType').value==='static' && document.getElementById('lineStickerCount').value==='32' && WorkspaceShell.state.line.dirty");
  await evaluate("document.getElementById('workspace-atlas').click()");
  await check('LINE→Atlasで双方stateとdirtyを維持', "document.getElementById('imageCount').textContent==='1' && WorkspaceShell.state.atlas.dirty && WorkspaceShell.state.line.dirty && document.getElementById('lineStickerCount').value==='32' && WorkspaceShell.hasUnsavedChanges()");
  await evaluate("document.getElementById('offsetX').value='3';document.getElementById('offsetX').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('offsetY').value='-2';document.getElementById('offsetY').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('groupId').value='walk';document.getElementById('groupId').dispatchEvent(new Event('input',{bubbles:true}));window.originalFlipPixels=await thumbPixels(0);document.getElementById('flipHorizontalCopy').click()");
  await until("document.getElementById('imageCount').textContent==='2' && document.querySelectorAll('.image-row.selected').length===1");
  await check('左右反転コピーの画素・命名・offset継承・Animation未所属', "JSON.stringify(await thumbPixels(1))===JSON.stringify(Array.from({length:6},(_,i)=>originalFlipPixels.slice((Math.floor(i/3)*3+(2-i%3))*4,(Math.floor(i/3)*3+(2-i%3)+1)*4)).flat()) && document.querySelectorAll('.sprite-name')[1].textContent==='asymmetric_flipH' && document.getElementById('offsetX').value==='3' && document.getElementById('offsetY').value==='-2' && document.getElementById('groupId').value==='' ");
  await evaluate("document.querySelectorAll('.image-row')[0].click();document.getElementById('flipVerticalCopy').click()");
  await until("document.getElementById('imageCount').textContent==='3' && document.querySelectorAll('.sprite-name')[1].textContent==='asymmetric_flipV'");
  await check('上下反転コピーの画素・元Sprite直後への挿入', "JSON.stringify(await thumbPixels(1))===JSON.stringify(originalFlipPixels.slice(12).concat(originalFlipPixels.slice(0,12))) && document.querySelectorAll('.sprite-name')[2].textContent==='asymmetric_flipH'");
  await evaluate("document.getElementById('clearImages').click()");
  await until("document.getElementById('imageCount').textContent==='0'");
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
  await evaluate(`window.canvasAlphaY=id=>{const c=document.getElementById(id),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let min=c.height,max=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]){min=Math.min(min,y);max=Math.max(max,y);}return{min,max};};testSet('alignment','center');document.querySelectorAll('.image-row')[1].click();document.getElementById('offsetX').value='3';document.getElementById('offsetX').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('offsetY').value='4';document.getElementById('offsetY').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('exportButton').click()`);await until("!document.getElementById('downloadPanel').hidden");await evaluate("window.atlasUiPlus=await(await fetch(document.getElementById('downloadJson').href)).json();document.getElementById('cancelDownloads').click();window.beforeAtlasPlus=canvasAlphaY('selectedCanvas');document.querySelector('button[data-action=offsetY][data-delta=\"1\"]').click();document.getElementById('exportButton').click()");await until("!document.getElementById('downloadPanel').hidden");await evaluate("window.atlasAfterPlus=await(await fetch(document.getElementById('downloadJson').href)).json();document.getElementById('cancelDownloads').click();window.afterAtlasPlus=canvasAlphaY('selectedCanvas')");
  await check('Atlas UI +4入力はinternal -4・X方向は従来どおり', "atlasUiPlus.sprites[1].offsetX===3 && atlasUiPlus.sprites[1].offsetY===-4 && document.getElementById('offsetX').value==='3'");
  await check('Atlas +1ボタンはinternalYを1減らし画像を1px上へ移動', "atlasAfterPlus.sprites[1].offsetY===-5 && document.getElementById('offsetY').value==='5' && afterAtlasPlus.min===beforeAtlasPlus.min-1 && afterAtlasPlus.max===beforeAtlasPlus.max-1");
  await evaluate("window.beforeAtlasMinus=canvasAlphaY('selectedCanvas');document.querySelector('button[data-action=offsetY][data-delta=\"-1\"]').click();document.getElementById('exportButton').click()");await until("!document.getElementById('downloadPanel').hidden");await evaluate("window.atlasAfterMinus=await(await fetch(document.getElementById('downloadJson').href)).json();document.getElementById('cancelDownloads').click();window.afterAtlasMinus=canvasAlphaY('selectedCanvas');document.getElementById('offsetY').value='-4';document.getElementById('offsetY').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('exportButton').click()");await until("!document.getElementById('downloadPanel').hidden");await evaluate("window.atlasUiMinus=await(await fetch(document.getElementById('downloadJson').href)).json()");
  await check('Atlas -1ボタンはinternalYを1増やし画像を1px下へ移動', "atlasAfterMinus.sprites[1].offsetY===-4 && afterAtlasMinus.min===beforeAtlasMinus.min+1 && afterAtlasMinus.max===beforeAtlasMinus.max+1");
  await check('Atlas UI -4入力はinternal +4', "atlasUiMinus.sprites[1].offsetY===4 && document.getElementById('offsetY').value==='-4'");
  await evaluate("document.getElementById('cancelDownloads').click();document.getElementById('bottomAlign').click()");
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
  await check('数値入力と1px補正を出力JSONへ内部値で反映', "(await (await fetch(document.getElementById('downloadJson').href)).json()).sprites.every((s,i)=>i!==0 || (s.offsetX===-3 && s.offsetY===1 && s.placement==='centroid-bottom'))");
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
  await evaluate(`window.makeGridAtlas=async()=>{const c=document.createElement('canvas');c.width=1280;c.height=684;const ctx=c.getContext('2d');
    for(let row=0;row<3;row++)for(let col=0;col<8;col++){if(row===2&&col>0)continue;ctx.fillStyle='hsl('+((row*8+col)*21)+' 80% 50%)';ctx.fillRect(col*160+20,row*228+24,120,180);}
    const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'grid-example.png',{type:'image/png'}));const input=document.getElementById('gridInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));};await makeGridAtlas();`);
  await until("document.getElementById('gridSummary').textContent.includes('全24セル') && document.getElementById('gridSummary').textContent.includes('非透明17セル')");
  await check('Grid推定・1280×684・160×228・8×3・最終行一部有効', "document.getElementById('gridColumns').value==='8' && document.getElementById('gridRows').value==='3' && document.getElementById('gridCellWidth').value==='160' && document.getElementById('gridCellHeight').value==='228' && document.getElementById('gridInference').textContent.includes('推定値')");
  await evaluate("document.getElementById('gridCellWidth').value='159';document.getElementById('gridCellWidth').dispatchEvent(new Event('input',{bubbles:true}))");
  await check('不正Grid値を分割前に表示', "!document.getElementById('gridValidation').hidden && document.getElementById('gridValidation').textContent.includes('一致')");
  await evaluate("document.getElementById('gridCellWidth').value='160';document.getElementById('gridCellWidth').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('addGrid').click()");
  await until("document.getElementById('imageCount').textContent==='17' && !document.getElementById('exportButton').disabled");
  await check('Grid分割は透明セルを除外し共通Sprite経路へ追加', "document.querySelectorAll('.image-row').length===17 && document.querySelectorAll('.sprite-name')[16].textContent==='grid-example_r03_c01' && document.getElementById('previewStats').textContent.includes('17 スプライト') && !document.getElementById('flipHorizontalCopy').disabled");
  await evaluate("splitTest(1)"); await until("document.getElementById('imageCount').textContent==='18'");
  await evaluate("window.editSprite('spriteTags',' purple, walk, ,purple, Walk, character:purple ')");
  await check('Tagsをtrim・空要素除外・重複除外し大文字小文字を区別', "document.getElementById('spriteTags').value.includes('purple') && document.getElementById('validation').hidden");
  await evaluate("window.editSprite('spriteTags','" + "x".repeat(65) + "')");
  await check('64文字超のtagはvalidation error', "!document.getElementById('validation').hidden && document.getElementById('validation').textContent.includes('64文字') && !document.getElementById('spriteTags').checkValidity()");
  await evaluate("editSprite('spriteTags','purple, walk, Walk, character:purple');editSprite('offsetX',5);editSprite('offsetY',-4);editSprite('groupId','grid-walk');editSprite('animationOrder',2);editSprite('durationFrames',4);editSprite('groupFps',18);window.projectAtlasBefore=document.getElementById('atlasCanvas').toDataURL();document.getElementById('prepareProject').click()");
  await until("!document.getElementById('saveProjectLink').hidden");
  await evaluate("window.projectOne=await(await fetch(document.getElementById('saveProjectLink').href)).json()");
  await check('通常Project v2はUI符号変換後も内部offset・抽出配置・Animationを保持', "projectOne.format==='sprite-atlas-project' && projectOne.version===2 && projectOne.storageMode==='standard' && projectOne.sprites.length===18 && projectOne.sprites.some(s=>s.extracted) && projectOne.sprites[0].tags.join('|')==='purple|walk|Walk|character:purple' && projectOne.sprites[0].offsetX===5 && projectOne.sprites[0].offsetY===4 && projectOne.sprites[0].groupId==='grid-walk' && projectOne.sprites[0].animationOrder===2 && projectOne.sprites[0].durationFrames===4 && projectOne.groups.find(g=>g.id==='grid-walk').fps===18 && projectOne.sprites.every(s=>s.image.startsWith('data:image/png;base64,') && s.sourceScaleX===1 && s.sourceScaleY===1)");
  await check('Atlas Project生成だけではdirtyを解除しない', "WorkspaceShell.state.atlas.dirty && document.getElementById('confirmProjectSave').disabled");
  await evaluate("window.lineDirtyBeforeAtlasSave=WorkspaceShell.state.line.dirty;document.getElementById('saveProjectLink').click();document.getElementById('confirmProjectSave').click()");
  await check('Atlas保存完了確認後dirty=false・LINE dirtyとは独立', "!WorkspaceShell.state.atlas.dirty && WorkspaceShell.state.line.dirty===lineDirtyBeforeAtlasSave");
  await evaluate(`document.getElementById('clearImages').click();const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(projectOne)],'roundtrip.satlas.json',{type:'application/json'}));const input=document.getElementById('projectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.getElementById('notice').textContent.includes('18 Spriteの編集Projectを読み込みました')");
  await check('Project LOADで内部offsetYと画素を維持しUIだけ反転', "document.getElementById('imageCount').textContent==='18' && document.getElementById('atlasCanvas').toDataURL()===projectAtlasBefore && document.getElementById('spriteTags').value==='purple, walk, Walk, character:purple' && document.getElementById('offsetX').value==='5' && document.getElementById('offsetY').value==='-4' && document.getElementById('groupFps').value==='18' && projectOne.sprites.some(s=>s.extracted) && !WorkspaceShell.state.atlas.dirty");
  await evaluate(`const p=structuredClone(projectOne);p.sprites[0].offsetY=3;document.getElementById('notice').textContent='';const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(p)],'internal-plus-3.satlas.json',{type:'application/json'}));const input=document.getElementById('projectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);await until("document.getElementById('notice').textContent.includes('18 Spriteの編集Projectを読み込みました')");
  await check('Atlas既存Project internal +3は移行せずUI -3表示', "document.getElementById('offsetY').value==='-3' && document.getElementById('offsetY').getAttribute('aria-label').includes('+は上方向')");
  await evaluate("document.getElementById('offsetY').value='3';document.getElementById('offsetY').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('prepareProject').click()");await until("!document.getElementById('saveProjectLink').hidden");await evaluate("window.projectInternalMinus3=await(await fetch(document.getElementById('saveProjectLink').href)).json()");
  await check('Atlas UI +3入力はProject internal -3で保存', "projectInternalMinus3.sprites[0].offsetY===-3 && document.getElementById('offsetY').value==='3'");
  await evaluate(`document.getElementById('notice').textContent='';const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(projectOne)],'restore.satlas.json',{type:'application/json'}));const input=document.getElementById('projectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);await until("document.getElementById('notice').textContent.includes('18 Spriteの編集Projectを読み込みました')");
  await evaluate("document.getElementById('prepareProject').click()"); await until("!document.getElementById('saveProjectLink').hidden");
  await evaluate(`const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d'),image=ctx.createImageData(512,512);for(let i=0;i<512*512;i++){image.data[i*4]=(i*73)%256;image.data[i*4+1]=(i*151+Math.floor(i/512)*31)%256;image.data[i*4+2]=(i*199+Math.floor(i/512)*17)%256;image.data[i*4+3]=255;}ctx.putImageData(image,0,0);const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],'large-source.png',{type:'image/png'}));const input=document.getElementById('fileInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.getElementById('imageCount').textContent==='19' && !document.getElementById('exportButton').disabled");
  await check('LOAD後のSprite追加で古いProject保存リンクを無効化', "document.getElementById('saveProjectLink').hidden && !document.getElementById('saveProjectLink').hasAttribute('href') && document.getElementById('projectStatus').textContent.includes('未保存の変更')");
  await evaluate("window.projectAtlasWithLarge=document.getElementById('atlasCanvas').toDataURL();document.getElementById('prepareProject').click()"); await until("!document.getElementById('saveProjectLink').hidden");
  await evaluate("window.projectTwo=await(await fetch(document.getElementById('saveProjectLink').href)).json();window.standardProjectLength=JSON.stringify(projectTwo).length");
  await check('最新の通常Projectに追加Spriteを含める', "projectTwo.sprites.length===19 && projectTwo.sprites[18].name==='large-source' && projectTwo.sprites[18].width===512 && projectTwo.sprites[18].height===512");
  await evaluate(`document.getElementById('clearImages').click();const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(projectTwo)],'standard-v2.satlas.json',{type:'application/json'}));const input=document.getElementById('projectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.getElementById('notice').textContent.includes('19 Spriteの編集Projectを読み込みました')");
  await check('追加後の通常Project LOADで最終Atlas画素を復元', "document.getElementById('atlasCanvas').toDataURL()===projectAtlasWithLarge");
  await evaluate("document.getElementById('prepareProject').click()"); await until("!document.getElementById('saveProjectLink').hidden");
  await evaluate("window.projectThree=await(await fetch(document.getElementById('saveProjectLink').href)).json()");
  await check('通常ProjectのSAVE→LOAD→再SAVEが論理一致', "JSON.stringify(projectTwo)===JSON.stringify(projectThree)");
  await evaluate("document.getElementById('projectStorageMode').value='compact';document.getElementById('projectStorageMode').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('prepareProject').click()"); await until("!document.getElementById('saveProjectLink').hidden");
  await evaluate("window.projectCompact=await(await fetch(document.getElementById('saveProjectLink').href)).json();window.compactProjectLength=JSON.stringify(projectCompact).length");
  await check('Compact Projectは埋め込み画像を軽量化', "projectCompact.version===2 && projectCompact.storageMode==='compact' && projectCompact.sprites.length===19 && projectCompact.sprites[18].width<512 && projectCompact.sprites[18].height<512 && projectCompact.sprites[18].sourceScaleX<1 && compactProjectLength<standardProjectLength*.6");
  await evaluate(`document.getElementById('clearImages').click();const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(projectCompact)],'compact-v2.satlas.json',{type:'application/json'}));const input=document.getElementById('projectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until("document.getElementById('notice').textContent.includes('19 Spriteの編集Projectを読み込みました')");
  await check('Compact Projectを共通Sprite経路へLOAD', "document.getElementById('imageCount').textContent==='19' && document.querySelectorAll('.sprite-name')[18].textContent==='large-source' && document.getElementById('projectStorageMode').value==='compact' && !document.getElementById('exportButton').disabled");
  await evaluate("document.getElementById('exportButton').click()"); await until("!document.getElementById('downloadPanel').hidden");
  await check('Runtime JSONへTagsを最小追加しProject画像は混入しない', "(async()=>{const j=await(await fetch(document.getElementById('downloadJson').href)).json();return j.meta.version===2 && j.sprites[0].tags.join('|')==='purple|walk|Walk|character:purple' && !('image' in j.sprites[0]);})()");
  await evaluate(`document.getElementById('cancelDownloads').click();window.atomicSignature=()=>JSON.stringify({count:document.getElementById('imageCount').textContent,names:Array.from(document.querySelectorAll('.sprite-name')).map(e=>e.textContent),atlas:document.getElementById('atlasCanvas').toDataURL(),tags:document.getElementById('spriteTags').value});window.atomicBefore=atomicSignature();window.loadProjectText=text=>{document.getElementById('notice').textContent='';const dt=new DataTransfer();dt.items.add(new File([text],'invalid.satlas.json',{type:'application/json'}));const input=document.getElementById('projectInput');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));};`);
  await evaluate("loadProjectText('{broken')"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('malformed JSONのatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);p.version=99;loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('wrong format/versionのatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);p.sprites[0].image='data:image/png;base64,broken';loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('broken embedded imageのatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);p.settings.cellWidth=0;loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('invalid settingsのatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);p.sprites[0].tags=['" + "x".repeat(65) + "'];loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('invalid tagのatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);p.sprites[0].animationOrder=-1;loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('invalid Animationのatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);const base=p.sprites[0];p.sprites=Array.from({length:501},(_,i)=>({...base,name:'sprite_'+i}));loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('maxImages超過のatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("const p=structuredClone(projectTwo);p.sprites[0].width=10000;p.sprites[0].height=10000;loadProjectText(JSON.stringify(p))"); await until("document.getElementById('notice').textContent.includes('現在の編集内容は維持')");
  await check('pixel limit超過のatomic LOAD', "atomicSignature()===atomicBefore");
  await evaluate("document.getElementById('clearImages').click()");
  await evaluate("localStorage.setItem('sprite-atlas.settings.v1','{broken')");
  await reload();
  await check('壊れた保存JSONで初期値へ復帰', "document.getElementById('settingsForm').elements.scaleMode.value==='individual' && document.getElementById('notice').textContent.includes('初期値')");
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Storage.prototype.getItem=function(){throw new Error('storage blocked');};Storage.prototype.setItem=function(){throw new Error('storage blocked');};" });
  await reload();
  await check('localStorage利用不可でも起動・警告', "document.getElementById('nextFilename').textContent.includes('_0000.png') && document.getElementById('notice').classList.contains('warning')");
  if (process.env.ATLAS_SCREENSHOT) {
    await evaluate("document.getElementById('workspace-line').click();document.getElementById('lineType').value='static';document.getElementById('lineType').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('lineStickerCount').value='8';document.getElementById('lineStickerCount').dispatchEvent(new Event('change',{bubbles:true}));window.scrollTo(0,0)");
    const lineShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(process.env.ATLAS_SCREENSHOT),Buffer.from(lineShot.data,'base64'));
  }
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
