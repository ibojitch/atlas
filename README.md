# Sprite Atlas

複数の画像から、透明余白を取り除いてセルに配置した透過PNGと、ゲームで使えるJSONインデックスを作るローカル制作ツールです。

HTML / CSS / Vanilla JavaScriptのみで動作します。外部ライブラリ、CDN、サーバー、npm、ビルド作業は不要です。入力画像・画像名・設定を外部に送信しません。

## 2つのワークスペース

画面上部で **Sprite Atlas** と **LINEスタンプ**を切り替えられます。切替は表示するDOMを変更するだけで、Atlasの画像・順番・設定・Inspector・Tags・offset・Animation・Group FPS・Grid追加結果・Project状態と、LINE Projectの状態をそれぞれメモリ上に保持します。切替のためのSAVE→LOADは不要です。

各ワークスペースは独立した未保存状態を持ちます。ヘッダーはdirtyなら「● 未保存」、dirtyでなければ、新規起動直後にも適切な「変更なし」と表示します。Projectデータを「用意」しただけではdirtyを解除しません。保存リンクを使用し、実際にファイルを保存できたことを確認してから「保存完了を確認」を押すと、そのワークスペースだけdirtyを解除します。正常なProject LOAD後も解除し、LOAD失敗時は現在のProjectと未保存状態を維持します。

未保存変更があるProjectのLOAD、新規作成、全削除では確認ダイアログを表示します。キャンセルすると現在の状態を変更しません。ワークスペース切替では確認しません。AtlasまたはLINEのどちらかに未保存変更がある場合や、既存の書き出し準備・保存・読込処理中は、ページ更新やタブを閉じる際にブラウザ標準の離脱確認を使用します。

### LINEスタンプ — Static Phase 2

LINEワークスペースでは、Static Stickerの元画像読込からtrim、fit、位置調整、Main / Tab生成、個別PNG、提出用ZIPまでを完結できます。複数選択、drop、paste、スロット差し替え・削除・並べ替えに対応し、Preview・個別PNG・ZIPは同じ描画処理を使います。

```json
{
  "format": "line-stamp-project",
  "version": 2,
  "type": "static",
  "targetStickerCount": 8,
  "mainImage": { "sourceStickerId": null, "offsetX": 0, "offsetY": 0 },
  "tabImage": { "sourceStickerId": null, "offsetX": 0, "offsetY": 0 },
  "stickers": []
}
```

Staticは8 / 16 / 24 / 32 / 40個から選択します。Stickerはalphaしきい値より大きい画素へtrimし、アスペクト比を保って最大370×320px以内・縦横偶数・約10px余白の可変Canvasへ配置します。Mainは240×240px、Tabは96×74px固定で、任意Stickerの元画像と専用offsetから生成します。

ZIPは外部ライブラリを使わないSTORE方式で、CRC32、local header、central directory、end recordを生成します。直下に`main.png`、`tab.png`、`01.png`以降の連番だけを格納します。各PNG 1MB以下、必要スロット、Main / Tab、ZIP 60MB以下を出力前に検証します。Canvasが保証できない72dpi metadataと厳密なRGB profileはvalidation対象外としてUIに明示します。

### Project v2とスロット

Static / Animatedのtype切替では、現在数を新しいtypeで利用可能な候補のうち**現在値以下で最大の数**へ丸めます。Static画像が存在する状態でAnimatedへ切り替える場合は、画像を暗黙に変換せず確認後に新しい空Projectへ切り替えます。Static 40 / 32はAnimated 24へ、24 / 16 / 8は同じ数へ移行します。AnimatedからStaticへの8 / 16 / 24は維持します。

Sticker Objectは、配列位置だけに依存せず、安定IDと1始まりの明示的な`slot`番号を持ちます。Main / TabはIDを参照するため並べ替え後も同じ絵を維持します。Project v2は元画像のData URL、元寸法、trim / fit / offset、Main / Tab専用値を保存し、一時Canvas、ImageBitmap、Object URL、Preview、ZIP Blobは保存しません。Project v1は空Sticker ProjectとしてLOADし、v2へ移行します。LOADは全画像を一時領域で検証・decodeしてから入れ替えるatomic方式です。

共通制約は各画像1MB以下、ZIP全体60MB以下、RGB、背景透過です。Static固有制約はPNG、最大370×320px、縦横偶数、72dpi以上、コンテンツ外周に約10pxの余白推奨です。Animated固有制約はAPNG、最大320×270px、縦横いずれか270px以上、全frame同寸法、5～20 frames、loop 1～4、再生時間1 / 2 / 3 / 4秒、合計4秒以内、frame余白と動かない部分の除去、1frame目を静止表示にも使用、です。Static固有の偶数サイズ・72dpi以上はAnimatedへ共通化していません。

Animated StickerはUI上で開発中と表示します。**APNG Exportは未実装**です。APNG decode / encode、frame editor、外部APNGライブラリは含めていません。画像の純粋計算、Canvas描画、ZIP、Projectモデルを分離し、将来のAnimated encoder層を追加できる構造にしています。

## 起動方法

このフォルダの **index.html をChromeまたはEdgeで開いてください**。ファイルをダブルクリックするだけで利用できます。関連ファイルは同じフォルダに置いてください。

Chrome / Edgeの現行デスクトップ版を主対象にしています。file://で動作を検証しています。他のブラウザでは、画像形式、クリップボード、ダウンロード、ローカルストレージの扱いが異なることがあります。

## 基本操作

1. 複数画像を画面へドロップするか、「画像を選択」で追加します。画像をコピーしてCtrl+V / ⌘+Vで貼り付けることもできます。
2. セル幅・高さ、列数、トリミング、スケーリング方式を設定します。
3. 中央の一覧でSpriteを選び、右Inspectorで名前・Tags・XY補正を編集します。一覧の↑ / ↓ ボタンはAtlas順を変更します。
4. プレビューのサイズと配置を確認します。表示倍率とセル境界は出力画像に影響しません。
5. 「PNG + JSON を用意」を押します。
6. 「PNG を保存」「JSON を保存」から両方のファイルを保存します。
7. 保存できたことを確認し、「2ファイルの保存完了・番号を進める」を押します。

読込失敗、完全透明、しきい値を超える画素がない画像は赤く表示され、出力から除外されます。正常な画像の読み込みや出力は継続します。一覧のindexは**出力される画像だけの0始まりの連番**で、エラー画像は「—」です。

「すべて削除」は画像一覧を空にします。入力ファイルそのものは変更しません。ブラウザ再起動後も編集を続ける場合は、左ペインの「編集Project」からProjectファイルを保存してください。

## 3ペインとSprite Inspector

FHD以上では画面高に合わせた3ペイン構成です。左292pxに出力設定・通常読込・分割追加・抽出設定・書き出し、中央上にAtlasプレビュー、中央下にSprite一覧、右320pxにInspectorを置いています。左と右は内部スクロール、一覧とAtlasプレビューも独立スクロールします。1100px以下では縦方向のページスクロールを許可し、700px以下では1列に切り替えます。

一覧行をクリック、またはキーボードでフォーカスしてEnter/Spaceで選択します。選択行は緑で表示され、index・サムネイル・名前・Group・Order・Durationを確認できます。名前とXY補正はInspectorで編集し、Atlas順の↑/↓と削除は一覧に残しています。初回読込では先頭を選択し、選択Spriteを削除した場合は残る先頭へ移動、全削除ではEmpty Stateになります。

右上の選択SpriteプレビューとAnimation Previewは、既存の `makePlan()` で描画した最終Atlasからセルを切り出す共通処理を使います。scale・trim・9点配置・重心/下端配置・offset・セル境界でのクリップ・補間はAtlasと一致します。表示のCSS縮小以外で座標を計算し直しません。

## Animationの編集とプレビュー

1. Spriteを選択し、右InspectorのGroup IDに例として `walk` を入力します。通常画像と分割画像を同じGroupに入れられます。
2. 各SpriteのAnimation Orderを0以上の整数、Duration Framesを1以上の整数で設定します。初期値はそれぞれ0と1です。
3. Group FPSを正の有限数で設定します（初期値60、小数も可）。FPSはSpriteごとでなくGroupごとに1つだけ保持され、同じIDの全Spriteに共有されます。
4. 「再生」で選択SpriteのGroupを再生し、「停止」で先頭フレームへ戻ります。ループOFFでは最後のフレームで止まります。現在のフレーム番号・Sprite名・Order・Duration・Group・FPSを表示します。

表示時間は **Duration Frames ÷ FPS 秒**。60 FPSなら3 frames = 50ms、6 frames = 100msです。フレームごとに異なる保持時間を指定できます。requestAnimationFrameの経過時間から現在フレームを直接求めるため、描画が遅れても遅延をフレームごとに累積しません。ブラウザの更新頻度より短いフレームは表示されずに飛ぶ場合があります。

**Atlas順とAnimation順は別です。** Atlasは入力一覧の順番、AnimationはGroup一致→Animation Order昇順→同値なら出力Atlas index昇順で決定します。一覧を並べ替えても明示したOrderは変わらず、同値の場合のみAtlas順に従います。

Group IDは前後をtrimし、空欄・空白のみは未所属です。大文字小文字は区別します。内部はMap、出力辞書はObject.create(null)を用い、`__proto__`、`constructor`等も使えます。不正なOrder・Duration・FPSはエラー表示し、出力・再生を止めます。有効画素のないSpriteは従来どおりAtlasから除外され、そのSpriteのAnimationフレームも出力しません。

編集中の設定はプレビューへ即時反映します。再生中にoffset・FPS・Order・Duration等を変更すると更新後のGroupを先頭から再生し直します。別Groupの選択では停止します。画像・Animation設定はlocalStorageからは復元されませんが、Project SAVE / LOADで復元できます。

### JSON version 2のAnimation定義

従来のmeta・sprites座標を維持し、meta.versionを2へ変更しました。各spriteにはgroupId・animationOrder・durationFramesを追加し、トップレベルにanimationsを出力します。Animationなしでも `"animations": {}` を出力します。

```json
"animations": {
  "walk": {
    "fps": 60,
    "frames": [
      { "sprite": 2, "duration": 3 },
      { "sprite": 0, "duration": 6 }
    ]
  }
}
```

これはJSON内のanimations部分の例です。`frames[].sprite` は **出力Atlasのsprites配列のindex**、`duration` はDuration Framesでありミリ秒ではありません。未所属SpriteやメンバーのいないGroupは含みません。出力準備時にGroup設定もスナップショットするため、その後の編集で準備済みPNG/JSONの内容は変わりません。

既知の制約：1 Spriteにつき所属Groupは1つです。Timeline、Tween、補間Animation、骨・IK、イベント、音声同期、レイヤー合成、複数Atlas、Runtime JSONからのAnimation再読込はありません。編集再開にはRuntime JSONではなくProjectファイルを使います。

## 各設定

| 設定 | 初期値 | 動作 |
| --- | --- | --- |
| セル幅 / 高さ | 128 / 128 px | それぞれ正の整数。出力上限も適用されます |
| セル内余白 | 8 px | セルの各辺から確保。128×128なら描画可能領域112×112 |
| 列数 | 4 | 左上から右へ配置し、列数で折り返します |
| alphaしきい値 | 1 | 0〜255の整数。alpha > しきい値の画素が有効 |
| トリム追加余白 | 0 px | 外接矩形の外側に足す透明な余白。元画像のピクセル単位 |
| スケーリング方式 | Individual Fit | 下記参照 |
| 配置 | 中央 | 9点配置。下中央へのショートカットあり |
| 補間方式 | Smooth | なめらかな補間 / Pixel（Nearest） |
| 2の累乗へ拡張 | OFF | Canvasの幅・高さをそれぞれ次の2の累乗に拡張 |
| 小さい画像の拡大を許可 | ON | OFFなら倍率が1を超えません |

追加余白は外接矩形の外側に新しく作る透明な領域です。元画像の端に達しても余白量は変わりません。このためJSONの`trim.x / y`は負になる場合があります。余白を含めたサイズをセルに収めるので、追加余白を増やすと実画像は小さくなります。

しきい値は外接矩形の判定に用います。矩形の内側に残った半透明ピクセルのalpha値を二値化・変更する機能ではありません。しきい値255では全画像に有効画素がなくなります。

全面不透明の画像は全面を有効領域とし、透明余白のトリミングを行わない旨を一覧に表示します。JPEGの背景色などを除去する機能はありません。

Smoothは`imageSmoothingEnabled = true`、`imageSmoothingQuality = "high"`、Pixelは`imageSmoothingEnabled = false`で描画します。

### Individual Fit と Uniform Scale

**Individual Fit** は画像ごとに倍率を計算し、それぞれセル内に最大サイズで収めます。アイコンやアイテムなど、独立した画像に向いています。

**Uniform Scale** は全ての正常な画像についてトリム追加余白込みのサイズを調べ、全画像がセル内に収まる共通倍率を選びます。

```text
描画可能幅 = セル幅 − 2 × セル内余白
描画可能高さ = セル高さ − 2 × セル内余白
個別倍率 = min(描画可能幅 / トリム幅, 描画可能高さ / トリム高さ)
共通倍率 = 全画像の個別倍率の最小値
拡大OFFの場合は、さらに倍率の上限を1とする
```

例：トリム後100×200と50×100の画像を128×128・余白8に配置すると、Individual Fitではどちらも高さ112pxになります。Uniform Scaleでは倍率0.56を共有し、高さはそれぞれ112pxと56pxです。

アニメーションでは元画像の縮尺を揃えたうえで **Uniform Scale + 下中央** が便利です。キャラクターの部位・足の位置を認識する機能ではないため、ポーズによる外接矩形の変化から発生する位置ずれは別途調整が必要です。

### アトラスサイズとプレビュー

```text
rows = ceil(正常な画像数 / columns)
実配置幅 = columns × cellWidth
実配置高さ = rows × cellHeight
```

POTをONにするとCanvasのみ拡張します。例：640×384 → 1024×512。スプライト座標は変わりません。未使用セル・拡張領域・セル内余白は透明です。

プレビューはCSSだけで拡大縮小します。PNGの実ピクセルサイズは上部の表示値と一致します。チェッカーとセル境界はCSSのオーバーレイであり、PNGに焼き込まれません。

## PNG / JSON とファイル名

PNGは`canvas.toBlob()`で作成します。JSONは同じ描画計画から生成します。準備後に設定・画像を変更しても、表示中のダウンロードリンクは**準備した時点の内容**を保持します。新しい内容を用意するには現在の書き出しを完了するか閉じてください。

ファイル名は端末のローカル日付を使い、`YYYYMMDD_NNNN.png` / `.json`です。日付が変わると0000から再開します。9999を超えると10000以降を使います。

日付と最後に保存完了した番号をlocalStorageに保存します。通常ダウンロードの実際の完了・キャンセル・保存先エラーはWebページから検知できないため、**ユーザーの保存完了操作で連番を更新**します。

- 保存に失敗・キャンセルした場合は完了ボタンを押さず、同じリンクから再試行してください。
- 書き出しデータを「閉じる」と連番を進めません。既に保存した場合は同名ファイルにご注意ください。
- 設定保存が利用できない場合は警告し、画面内のメモリで動作を継続します。
- localStorageの消去、別ブラウザ、別プロファイル、アプリの移動、複数タブの同時準備ではファイル名が重複する可能性があります。
- 保存先に同名ファイルがあると、ブラウザが名前に`(1)`等を付ける場合があります。PNG名を変えた場合はJSONの`meta.image`も実際の名前に合わせてください。

### JSON形式

```json
{
  "meta": {
    "version": 2,
    "image": "20260916_0000.png",
    "cellWidth": 128,
    "cellHeight": 128,
    "columns": 4,
    "rows": 1,
    "atlasWidth": 512,
    "atlasHeight": 128,
    "contentWidth": 512,
    "contentHeight": 128,
    "scaleMode": "uniform",
    "alignment": "bottom-center",
    "padding": 8,
    "alphaThreshold": 1,
    "trimMargin": 0,
    "smoothing": "smooth",
    "powerOfTwo": false,
    "upscale": true
  },
  "sprites": [{
    "index": 0,
    "name": "idle",
    "source": "idle.png",
    "tags": ["character:purple", "motion:idle"],
    "x": 0,
    "y": 0,
    "width": 128,
    "height": 128,
    "sourceWidth": 140,
    "sourceHeight": 230,
    "trim": { "x": 20, "y": 15, "width": 100, "height": 200 },
    "bounds": { "x": 20, "y": 15, "width": 100, "height": 200 },
    "draw": { "x": 36, "y": 8, "width": 56, "height": 112 },
    "contentDraw": { "x": 36, "y": 8, "width": 56, "height": 112 },
    "scale": 0.56,
    "offsetX": 0,
    "offsetY": 0,
    "groupId": "",
    "animationOrder": 0,
    "durationFrames": 1
  }],
  "animations": {}
}
```

| フィールド | 座標系・意味 |
| --- | --- |
| `x, y, width, height` | アトラス上のセル矩形。ゲームでセルごと切り出す場合に使用 |
| `sourceWidth, sourceHeight` | デコード後の元画像寸法 |
| `bounds` | 元画像上のalpha有効画素の外接矩形。追加余白なし |
| `trim` | 元画像上の外接矩形を透明余白分拡張した仮想矩形 |
| `draw` | **セル内の相対座標**。透明な追加余白を含むトリム全体の配置 |
| `contentDraw` | **セル内の相対座標**。元画像の`bounds`を実際に描画する矩形 |
| `scale` | 元画像からの倍率。Uniform Scaleでは全スプライト同値 |

描画位置のアトラス絶対座標は`(sprite.x + sprite.contentDraw.x, sprite.y + sprite.contentDraw.y)`です。小数座標は意図的に保持し、倍率とアスペクト比の一致を優先しています。

## 複数キャラクターPNGの分割追加

1. alphaしきい値と「分割追加：島の最小画素数」（初期値100画素）を設定します。
2. 「複数キャラPNGを分割して追加」から、横1列にキャラクターが並ぶ透過PNGを1枚選択します。通常の画像選択・ドロップ・貼り付けは従来どおりです。
3. `alpha > threshold` の画素を8近傍で解析し、小さい島を除外した後、左端X順に最大8島を追加します。`hero_01`、`hero_02`のように命名し、既存名と重複すると追加の連番を付けます。検出数は画面に表示します。9島以上は部分追加せずエラーにします。
4. 画像一覧で `offsetX` / `offsetY` を数値入力または±1ボタンで調整します。通常追加・分割追加の全Sprite Itemが共通の `offsetX` / `offsetY` を持ち、同じUI・描画計算・JSON出力を使います。初期値は0、単位は倍率適用後の出力pxです。右・下が正で、プレビューへ即時反映します。

抽出画像は有効画素のX重心をセル中央に、最下端画素の下辺を `セル高さ − セル内余白` に配置します。重心は画素座標の平均として保持し、描画時には画素中心を表すため0.5を加えます。下端Yは最下端画素の座標で、描画には1を加えた外縁を使います。追加余白も含め、左右の重心から遠い側を基準にfitするため、偏った形状では通常のbbox中心fitより小さくなります。Individual Fit / Uniform Scaleは引き続き使用できます。9点配置は通常画像に適用され、抽出画像は重心・下端配置を使用します。手動でセル外へ移動した部分は既存どおりセル境界でクリップされます。

100画素未満の島をノイズとして除外してから最大8個を判定し、除外後の数をキャラクター数として表示します。除外した島数も表示します。保存済みの最小画素数は維持されるため、以前の値が8の場合はUIで100へ変更するか設定を初期値に戻してください。最大島との比率による相対フィルタは、大きいキャラと小さいキャラが混在すると小さいキャラを誤除外する可能性があるため、現時点では導入せず絶対画素数で調整します。

島分けと最小画素数の適用は追加時に固定されます。変更して分割し直すには、対象を削除して再追加してください。抽出時のしきい値以下の画素は透明にし、所属する島だけを保持するので、外接矩形が重なる別の島は混入しません。後からalphaしきい値を変えると、残っている画素でトリム・重心・下端を再計算しますが、除去した画素は復元されず、島の再分割も行いません。低alpha画素の描画は通常画像と同じトリム処理に従います。

制約：横1列専用で複数行は判定しません。接触するキャラは1島、離れた武器・装飾・エフェクトは別島になります。AI認識や部位統合、固定幅分割、レイヤー合成、自動アニメーション推定はありません。最小画素数を上げると小さいキャラ自体も除外されます。解析中は一時的に画素・ラベル・探索配列を使うため、大きなPNGではメモリ消費と待ち時間が増えます。

抽出画像も既存のSprite Item・`makePlan()`・描画・PNG/JSON出力を共有します。JSONの各spriteに `offsetX` / `offsetY`、抽出画像には `anchor` と `placement: "centroid-bottom"` を追加しています。抽出画像のbounds・anchor座標は切り出した画像内の座標です。描画ソースの準備はapp側、配置計算はcore側、描画はrenderer側に分離したままで、将来の合成済み描画ソースにも拡張可能です。

## Grid Sprite Atlasの分割追加

「Sprite Atlasを分割して追加」では、配置済みAtlasを矩形セル単位で切り出します。画像を選ぶと画像寸法、Cell幅・高さ、列・行、全セル数、非透明セル数を表示します。推定したGrid値は候補にすぎないため、分割前に手動で修正できます。完全透明セルは既定で除外し、非透明セルだけを通常Spriteと同じ`state.items`へ一括追加します。途中まで追加することはありません。

推定はX/Y方向のalpha占有区間と画像寸法の割り切れを使う保守的な補助です。一意に扱えない画像では1×1を提示して手動入力を促します。Sprite内部の透明な切れ目をセル境界と誤認する可能性があるため、必ずSummaryを確認してください。1280×684px、160×228px、8列×3行、全24セル中17セル有効（最下段は左端のみ）の形式も扱えます。

Grid専用上限は画像各辺4096px、64列、64行、全512セルです。さらに追加後のSprite数500件と、全入力画像合計96Mi画素の共通上限を満たす必要があります。上限・寸法不一致・復号失敗時は全体を中止します。

## 反転コピーとTags

Inspectorの「左右反転コピー」「上下反転コピー」は、選択Spriteの実画素を反転した別Spriteを元Sprite直後へ追加します。名前には`_flipH` / `_flipV`を付け、重複時は連番化します。offsetとTagsを引き継ぎ、Animation Group・Order・Durationは初期値へ戻します。通常追加、島分割、Grid分割、Project LOADのどのSpriteにも同じ処理を使用できます。

Tagsはカンマ区切りで入力します。前後空白と空要素を除き、完全一致の重複を除外します。大文字小文字は区別し、`character:purple`のような記号付きtagも使用できます。1 Sprite最大32個、1 tag最大64文字です。超過は切り捨てずvalidation errorにします。TagsはProjectとRuntime JSONの各spriteに保存されます。

## 編集Project SAVE / LOAD

編集ProjectはRuntime用PNG + JSONとは別機能です。「Projectを用意」で`.satlas.json`の保存リンクを作り、「ProjectをLOAD」で編集状態を復元します。Project SAVEはRuntime書き出し連番を進めず、Runtimeのpending downloadとも分離されています。Projectを用意した後に設定・Sprite・Tags・Animation等を編集すると、古い保存リンクを直ちに破棄します。最新状態を保存するには、もう一度Projectを用意してください。

保存方式は次の2種類です。

- **通常Project**：現在メモリ上にある画像を元解像度のPNGで保存します。無劣化ですが、大きな元画像を含むとProjectも大きくなります。
- **Compact Project**：現在のalpha有効範囲へ切り詰め、現在の描画倍率で必要な解像度までPNGを縮小します。編集中のメモリ上の画像は変更しません。後からCellを大幅に拡大したりalphaしきい値を下げたりしても、破棄された細部・範囲は戻りません。

Project形式はJSONベースで、識別子とRuntime JSONとは独立したversionを持ちます。新規保存はversion 2で、version 1もLOADできます。

```json
{
  "format": "sprite-atlas-project",
  "version": 2,
  "storageMode": "compact",
  "settings": {},
  "groups": [],
  "sprites": []
}
```

保存対象は保存方式、出力設定、Sprite順、PNG Data URLとして埋め込んだ各Sprite画像、Compact時の縮小率、name、source、Tags、offset、抽出配置方式、Animation属性、Group FPSです。ImageBitmap、Object URL、analysis、bounds、trim、thumbnail、選択状態、再生状態、現在フレーム、zoom、pending download、ファイル連番は保存しません。LOAD時に画像を再デコードし、解析・thumbnail・bounds・trim・anchorを現在のロジックで再生成します。Compact画像の縮小率は、トリム追加余白の意味を維持するために使用します。

LOADはatomicです。JSON、format/version、settings、Tags、Animation、Group FPS、画像、Sprite数、画素数を一時領域ですべて検証し、全画像の復号に成功してから現在の編集stateを入れ替えます。途中で失敗した場合は現在のProjectを維持し、一時ImageBitmapも破棄します。

## 設定保存

設定キーは`sprite-atlas.settings.v1`、連番キーは`sprite-atlas.sequence.v1`です。localStorageには全出力設定と島の最小画素数を保存し、不正な型・値は初期値に戻します。画像、各SpriteのTags・XY補正・Animation属性、Group FPSはlocalStorageへ保存しません。これらを含む編集状態の再開にはProject SAVE / LOADを使用します。Runtime JSONの再読み込みには対応していません。

## File System Access API

**任意機能のフォルダ直接保存はこの版では実装していません。** 通常ダウンロードが標準の保存方法です。`showDirectoryPicker`の有無に依存せず、file://でも基本機能を利用できます。

直接保存にはブラウザの対応、セキュアコンテキスト、ユーザー操作、フォルダ権限などの制約があります。また、ファイルの存在確認と新規作成を排他的に一体で行うAPIがなく、存在確認の直後に他のプロセスが同名ファイルを作る競合を完全には防げません。「既存ファイルを絶対に上書きしない」という要件を満たせない直接保存を提供しない設計にしています。

## 上限と既知の制限

- 最大500画像。各入力画像は各辺16384px以下・33,554,432画素（32Mi画素）以下。
- Grid Atlasは各辺4096px以下、最大64列×64行、全512セル以下。列・行をそれぞれ満たしても全セル上限を超えるGridは拒否します。
- 読み込み済み画像は合計100,663,296画素（96Mi画素）以下。
- 出力Canvasは各辺8192px以下・33,554,432画素以下。利用端末によってはこれより小さくてもメモリ不足になります。
- 元画像をImageBitmapとして保持します。alphaの256段階の外接矩形だけをキャッシュし、フルサイズのImageDataや解析用Canvasは保持しません。しきい値変更時の再デコードも行いません。
- ブラウザのデコード自体のメモリ使用量は、寸法チェックの前に発生することがあります。極端に大きい圧縮画像は事前に縮小してください。
- 入力はブラウザがデコードできる形式です。PNG / WebPを推奨します。SVG内の外部リソースは取り込む対象にしないでください。
- GIF / APNG / アニメーションWebPは読み込み時に得られた1フレームを固定します。フレーム分解や動画入力には対応しません。
- Pixelモードは最近傍補間です。整数倍率や整数座標を強制する機能ではありません。
- 色管理やSmooth補間の細部はブラウザに依存します。ICCプロファイル等の元画像メタデータは保持しません。
- ダウンロード後のディスク書き込み失敗、保存取消、名前変更をアプリから自動検知することはできません。
- 複数画像の読み込みは順番に実行します。ファイル一覧の並びはブラウザから受け取る順番です。任意の順番へ↑ / ↓で変更できます。
- 取り消し履歴、セルごとのピボット指定、ZIPコンテナ形式のProjectはありません。通常Projectは画像を元解像度のPNG Data URLとしてJSONへ埋め込むため、画像数・寸法に応じてファイルが大きくなります。Compact Projectは容量を減らせますが、元解像度へは戻せません。

## コード構成

- `index.html` — 日本語UIとローカルスクリプト読込。
- `style.css` — デスクトップ中心のレスポンシブUI、チェッカー、境界オーバーレイ。
- `atlas-core.js` — DOM非依存のalpha解析、Grid・Tags・Project構造検証、fit、共通倍率、配置、レイアウト、JSON、Animation順序・時間・検証、名前・連番・設定検証。
- `atlas-render.js` — 描画計画をCanvasへ描く処理、最終Atlasのセルを切り出す共通プレビュー、PNG生成。テストでも同じ処理を利用。
- `line-core.js` — LINE Project v1移行/v2検証、明示slot、並べ替え・削除・出力validation。
- `line-image-core.js` / `line-render.js` — LINE用alpha trim・fit計画と、Preview / PNG / ZIP共通Canvas描画。
- `zip-writer.js` — CRC32を含む外部依存なしのZIP STORE writer。
- `line-app.js` — Static画像入力、Inspector、Main / Tab、atomic LOAD、PNG / ZIPダウンロード。
- `app.js` — 明示的な状態オブジェクト、共通Sprite生成、Grid分割、Project画像serialization/atomic LOAD、Sprite選択、Inspector、Group共有FPS、再生、入力、画像リソース解放、設定保存、ダウンロード。
- `core-tests.js` — 純粋関数の自動テスト。
- `tests.html` / `browser-tests.js` — ブラウザ上での計算・PNG画素テスト。
- `browser-smoke.cjs` — 任意の開発用画面操作テスト。

## テスト

### Node不要のブラウザテスト

`tests.html`を直接開くと74項目を実行します。PNGを再デコードして画素・透明度を確認するほか、LINE trim / fit、Project v1/v2、Main / Tab、ZIP CRCと格納PNG一致も検証します。Node単独の`core-tests.js`は64項目です。

### 任意の開発用テスト

Nodeが既に入っている環境では、追加ライブラリを入れずに以下を実行できます。**ツール自体の起動にNodeは不要です。**

```text
node core-tests.js
node browser-smoke.cjs
```

画面操作テストはNode 22以降とインストール済みChrome / Edgeを使用します。追加npm依存はありません。検出順はATLAS_BROWSER指定→代表的なOS別Chrome/Edgeパス→PATH→既存Chrome for Testingの代表的な展開先/Puppeteerキャッシュです。指定したATLAS_BROWSERが起動できない場合は、別ブラウザへ黙って切り替えずエラーにします。macOS/Linux向けの候補もありますが、実機検証はWindows Chromeです。

PowerShellでの明示指定例：

```powershell
$env:ATLAS_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node browser-smoke.cjs
```

毎回OSのtemporary directoryへ専用user-data-dirを作成し、remote-debugging-port=0で空きポートをChromeに選ばせます。DevToolsActivePortを読み、127.0.0.1の/json/versionを短い間隔で再試行してHTTP 200と当該プロファイルのWebSocket endpointを確認した後に接続します。起動待機15秒・個別CDPコマンド20秒にタイムアウトを設けています。失敗時は実行ファイル、PID、port、user-data-dir、/json/version結果、失敗段階、timeout、Chrome stderrを表示します。

[Chrome公式のremote debugging変更案内](https://developer.chrome.com/blog/remote-debugging-port)に沿い、通常プロファイルは使いません。今回の環境では従来から一時プロファイルとport=0を使用していました。制限環境で再現した停止はHTTP 200の後、GPU子プロセスがアクセス拒否（exit_code=-1073741790）で終了したもので、プロファイル指定不足ではありません。通常のユーザー権限では成功しています。今回の変更でendpoint準備待ち、WebSocketエラー/切断処理、詳細ログを追加し、この違いを判別できるようにしました。OSや実行環境側の制限そのものを無効化する処理は入れていません。

終了時にはChrome終了を待ち、作成した一時ディレクトリがOSのtemporary directory直下のatlas-smoke-*であることを確認してから削除します。失敗時やSIGINT/SIGTERMも可能な範囲で後始末します。OSによる強制終了では一時フォルダが残る場合があります。ユーザーの通常Chromeプロファイルは変更しません。スクリーンショットを残す場合だけATLAS_SCREENSHOTに保存先ファイルの絶対パスを指定してください（既存ファイルは上書きします）。既定ではダウンロードしたテストPNG/JSONも一時プロファイルと一緒に削除します。

画面操作87項目で既存Atlas回帰に加え、LINE Static 8枚読込、trim / offset / 並べ替え、Main / Tab、全PNG / ZIP、Project v1/v2、atomic LOADを検証します。ZIPはWindows標準`tar`でも実際に展開します。続けて74項目の計算・Canvas・PNGテストを実行します。対話的な保存ダイアログやLINE Creators Marketへの実アップロードは自動テストの対象外です。
