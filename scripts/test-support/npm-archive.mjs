import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

export function tarArchive(entries) {
  const blocks = [];
  for (const {
    path,
    text = '',
    type = '0',
    link = '',
    owner = '',
  } of entries) {
    const contents = Buffer.isBuffer(text) ? text : Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(path, 0, 100);
    header.write('0000644\0', 100, 8);
    header.write('0000000\0', 108, 8);
    header.write('0000000\0', 116, 8);
    header.write(contents.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    header.write('00000000000\0', 136, 12);
    header.fill(32, 148, 156);
    header.write(type, 156, 1);
    header.write(link, 157, 100);
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);
    header.write(owner, 265, 32);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(
      header,
      contents,
      Buffer.alloc((512 - (contents.length % 512)) % 512),
    );
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
export function extendedAttribute(key, value) {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (String(length).length + 1 + Buffer.byteLength(body) !== length)
    length = String(length).length + 1 + Buffer.byteLength(body);
  return `${length} ${body}`;
}
