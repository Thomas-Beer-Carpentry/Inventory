import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// CLI: node decode-raster.mjs [bundle.js] [RGBA-fixture.json]
// Optional fixture shape: {width,height,rgba:[r,g,b,a,...],expected:"barcode"}.
// This tests the pinned JavaScript decoder, not media/camera/browser behavior.
// qrcode is a private upstream seam; keep this harness outside production code.
const bundlePath = process.argv[2] || fileURLToPath(new URL('../public/vendor/html5-qrcode.min.js', import.meta.url));
const context = { console, performance, document: { getElementById: () => ({}) } };
context.window = context;
vm.createContext(context);
vm.runInContext(readFileSync(bundlePath, 'utf8'), context);
const scanner = new context.Html5Qrcode('fixture', {
  formatsToSupport: [context.Html5QrcodeSupportedFormats.EAN_13],
  useBarCodeDetectorIfSupported: false,
});

function canonicalFixture() {
  // GS1 EAN-13 patterns, independently encoded for the known value 5901234123457.
  const expected = '5901234123457';
  const l = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const g = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const r = l.map(pattern => pattern.replace(/[01]/g, bit => bit === '1' ? '0' : '1'));
  // Leading digit 5 uses LGGLLG parity.
  let modules = '101';
  for (let index = 1; index <= 6; index++) modules += ('LGGLLG'[index - 1] === 'L' ? l : g)[Number(expected[index])];
  modules += '01010';
  for (let index = 7; index <= 12; index++) modules += r[Number(expected[index])];
  modules += '101';
  modules = '0'.repeat(12) + modules + '0'.repeat(12);
  const width = modules.length * 3, height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = 4 * (y * width + x);
    const value = y >= 10 && y < 110 && modules[Math.floor(x / 3)] === '1' ? 0 : 255;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return {width, height, rgba, expected};
}

const fixture = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : canonicalFixture();
assert.ok(Number.isSafeInteger(fixture.width) && fixture.width > 0);
assert.ok(Number.isSafeInteger(fixture.height) && fixture.height > 0);
assert.equal(fixture.rgba.length, fixture.width * fixture.height * 4);
const rgba = Uint8ClampedArray.from(fixture.rgba);
const canvas = {
  width: fixture.width,
  height: fixture.height,
  getContext: () => ({ getImageData: () => ({data: rgba, width: fixture.width, height: fixture.height}) }),
};
const result = await scanner.qrcode.decodeAsync(canvas);
if (fixture.expected !== undefined) assert.equal(result.text, fixture.expected);
assert.equal(result.format.formatName, 'EAN_13');
assert.equal(result.debugData.decoderName, 'zxing-js');
console.log(JSON.stringify({decoded: result.text, format: result.format.formatName, decoder: result.debugData.decoderName, width: fixture.width, height: fixture.height}));

// White pixels must not decode as the previous barcode.
rgba.fill(255);
await assert.rejects(scanner.qrcode.decodeAsync(canvas));
console.log('Blank raster rejected.');

