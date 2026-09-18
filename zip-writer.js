/* 外部依存なしのZIP STORE writer。PNGは既に圧縮済みなので再圧縮しません。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZipWriter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const encoder = new TextEncoder();
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function words(size) { return new Uint8Array(size); }
  function u16(a, o, n) { new DataView(a.buffer, a.byteOffset, a.byteLength).setUint16(o, n, true); }
  function u32(a, o, n) { new DataView(a.buffer, a.byteOffset, a.byteLength).setUint32(o, n >>> 0, true); }
  function concat(parts) { const size = parts.reduce((n,p)=>n+p.length,0), out = new Uint8Array(size); let at=0; for(const p of parts){out.set(p,at);at+=p.length;} return out; }
  function create(entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('ZIPに格納するファイルがありません。');
    const seen = new Set(), locals = [], centrals = []; let offset = 0;
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(entry.name) || seen.has(entry.name)) throw new Error('ZIPファイル名が不正または重複しています。');
      seen.add(entry.name); const name = encoder.encode(entry.name), data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data), crc = crc32(data);
      const local = words(30); u32(local,0,0x04034b50);u16(local,4,20);u16(local,6,0x0800);u16(local,8,0);u16(local,12,0x21);u32(local,14,crc);u32(local,18,data.length);u32(local,22,data.length);u16(local,26,name.length);
      const central = words(46);u32(central,0,0x02014b50);u16(central,4,20);u16(central,6,20);u16(central,8,0x0800);u16(central,10,0);u16(central,14,0x21);u32(central,16,crc);u32(central,20,data.length);u32(central,24,data.length);u16(central,28,name.length);u32(central,42,offset);
      const localPart = concat([local,name,data]); locals.push(localPart); centrals.push(concat([central,name])); offset += localPart.length;
    }
    const directory = concat(centrals), end = words(22);u32(end,0,0x06054b50);u16(end,8,entries.length);u16(end,10,entries.length);u32(end,12,directory.length);u32(end,16,offset);
    return concat([...locals,directory,end]);
  }
  function inspect(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input), view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), files=[]; let at=0;
    while(at+4<=bytes.length && view.getUint32(at,true)===0x04034b50){const flags=view.getUint16(at+6,true),method=view.getUint16(at+8,true),crc=view.getUint32(at+14,true),size=view.getUint32(at+18,true),nameLength=view.getUint16(at+26,true),extra=view.getUint16(at+28,true);if(method!==0||flags&8)throw new Error('STORE以外のZIPです。');const name=new TextDecoder().decode(bytes.slice(at+30,at+30+nameLength)),start=at+30+nameLength+extra,data=bytes.slice(start,start+size);if(data.length!==size||crc32(data)!==crc)throw new Error('ZIP CRC32が一致しません。');files.push({name,data,crc});at=start+size;}
    if(!files.length||view.getUint32(at,true)!==0x02014b50)throw new Error('ZIP構造が不正です。'); return files;
  }
  return { crc32, create, inspect };
});
