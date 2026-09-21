// Minimal ZIP reader for local content-pack import. Supports STORE (0) and DEFLATE (8).
const IAZip = (() => {
  const td = new TextDecoder();
  const u16 = (dv, o) => dv.getUint16(o, true);
  const u32 = (dv, o) => dv.getUint32(o, true);

  async function inflateRaw(bytes) {
    if (!('DecompressionStream' in window)) throw new Error('Il browser non supporta la decompressione ZIP locale.');
    const ds = new DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }

  async function read(fileOrBuffer) {
    const ab = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
    const dv = new DataView(ab);
    const bytes = new Uint8Array(ab);
    let eocd = -1;
    for (let i = ab.byteLength - 22; i >= Math.max(0, ab.byteLength - 65557); i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP non valido: directory centrale non trovata.');
    const total = u16(dv, eocd + 10);
    const cdOffset = u32(dv, eocd + 16);
    let pos = cdOffset;
    const out = new Map();
    for (let n = 0; n < total; n++) {
      if (u32(dv, pos) !== 0x02014b50) throw new Error('ZIP non valido: voce directory centrale corrotta.');
      const method = u16(dv, pos + 10);
      const compSize = u32(dv, pos + 20);
      const nameLen = u16(dv, pos + 28);
      const extraLen = u16(dv, pos + 30);
      const commentLen = u16(dv, pos + 32);
      const localOffset = u32(dv, pos + 42);
      const name = td.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      if (u32(dv, localOffset) !== 0x04034b50) throw new Error('ZIP non valido: header locale mancante.');
      const lNameLen = u16(dv, localOffset + 26);
      const lExtraLen = u16(dv, localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const compressed = bytes.slice(start, start + compSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) data = await inflateRaw(compressed);
      else throw new Error(`Compressione ZIP non supportata (${method}).`);
      out.set(name, data);
    }
    return out;
  }

  function text(bytes) { return td.decode(bytes); }
  function dataUrl(bytes, mime = 'application/octet-stream') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return `data:${mime};base64,${btoa(binary)}`;
  }
  function mimeFor(name) {
    const n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
    if (n.endsWith('.json')) return 'application/json';
    if (n.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
  }

  return { read, text, dataUrl, mimeFor };
})();
