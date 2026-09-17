/* LINE Static共通描画経路。Preview / 個別PNG / ZIPで同じ関数を使います。 */
(function (root, factory) {
  const api = factory(root.LineImageCore);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LineRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (I) {
  'use strict';
  function draw(canvas, item, plan) {
    canvas.width=plan.width;canvas.height=plan.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    const b=plan.bounds,d=plan.draw;ctx.drawImage(item.image,b.x,b.y,b.width,b.height,d.x,d.y,d.width,d.height);return plan;
  }
  function sticker(canvas,item){return draw(canvas,item,I.stickerPlan(item.bounds,item.edit));}
  function special(canvas,item,width,height,edit){return draw(canvas,item,I.fixedPlan(item.bounds,width,height,edit));}
  function pngBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.type==='image/png'?resolve(blob):reject(new Error('PNGを生成できません。')),'image/png'));}
  async function pngBytes(canvas){return new Uint8Array(await (await pngBlob(canvas)).arrayBuffer());}
  return { draw, sticker, special, pngBlob, pngBytes };
});
