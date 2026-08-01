import { deflateSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let k = 0; k < 8; k += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export async function createMockPng(file, width = 1080, height = 1440) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3, 248);
  row[0] = 0;
  const pixels = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(pixels, y * row.length);
  await writeFile(file, Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]));
}

export async function readPngDimensions(file) {
  const data = await readFile(file);
  if (data.length < 45 || !data.subarray(0, 8).equals(signature)) return null;
  let offset = 8;
  let dimensions = null;
  let hasImageData = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.length) return null;
    const type = data.subarray(offset + 4, offset + 8).toString();
    const payload = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = { width: payload.readUInt32BE(0), height: payload.readUInt32BE(4) };
    } else if (type === "IDAT") {
      hasImageData = true;
    } else if (type === "IEND") {
      return length === 0 && chunkEnd === data.length && hasImageData ? dimensions : null;
    }
    offset = chunkEnd;
  }
  return null;
}
