const invalid = () => Object.assign(Error('ASSET_INVALID'), { code:'ASSET_INVALID', status:400 });
/** Encoded dimensions, independent of EXIF display orientation. Shared by the
 * browser and server; this is a bounded header check, never an image decoder.
 */
export function chainImageHeader(bytes, mime) {
  if (!(bytes instanceof Uint8Array)) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  let width, height;
  try {
    if (mime === 'image/png') {
      if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)
        || view.getUint32(8) !== 13 || ascii(12, 16) !== 'IHDR') throw invalid();
      width = view.getUint32(16); height = view.getUint32(20);
    } else if (mime === 'image/jpeg') {
      if (bytes.length < 12 || view.getUint16(0) !== 0xffd8) throw invalid();
      let at = 2;
      while (at < bytes.length) {
        if (bytes[at++] !== 0xff) throw invalid();
        while (bytes[at] === 0xff) at++;
        const marker = bytes[at++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
        const length = view.getUint16(at);
        if (length < 2 || at + length > bytes.length) throw invalid();
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) {
          if (length < 8) throw invalid(); height = view.getUint16(at + 3); width = view.getUint16(at + 5); break;
        }
        at += length;
      }
    } else if (mime === 'image/webp') {
      if (bytes.length < 25 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) throw invalid();
      const chunk = ascii(12, 16), length = view.getUint32(16, true);
      if (20 + length > bytes.length) throw invalid();
      if (chunk === 'VP8X' && length >= 10) {
        width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      } else if (chunk === 'VP8L' && length >= 5 && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
      } else if (chunk === 'VP8 ' && length >= 10 && ascii(23, 26) === '\u009d\u0001\u002a') {
        width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
      } else throw invalid();
    } else throw invalid();
  } catch { throw invalid(); }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000) throw invalid();
  return { width, height };
}
/** Some browsers apply EXIF rotation even with imageOrientation:none. Both
 * decodes are safe after independent encoded-header validation; arbitrary
 * dimension changes and pixel-count differences are refused.
 */
export function chainDecodedDimensionsMatch(decoded, encoded) {
  return decoded.width === encoded.width && decoded.height === encoded.height
    || decoded.width === encoded.height && decoded.height === encoded.width;
}
