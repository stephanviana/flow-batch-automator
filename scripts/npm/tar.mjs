import { gunzipSync } from 'node:zlib';
import { posix } from 'node:path';

const LIMIT = 128 * 1024 * 1024;
function string(bytes) {
  return bytes.toString('utf8').replace(/\0.*$/s, '');
}
function number(bytes) {
  const value = string(bytes).trim();
  if (value && !/^[0-7]+$/.test(value))
    throw new Error('Unsupported tar numeric encoding.');
  return value ? parseInt(value, 8) : 0;
}
function extended(bytes) {
  const attributes = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const length = Number(bytes.toString('ascii', offset, space));
    if (
      space < 0 ||
      !Number.isSafeInteger(length) ||
      length <= space - offset + 1 ||
      offset + length > bytes.length
    )
      throw new Error('Invalid tar extended header.');
    const field = bytes.toString('utf8', space + 1, offset + length - 1);
    const equals = field.indexOf('=');
    if (equals < 1) throw new Error('Invalid tar extended attribute.');
    attributes[field.slice(0, equals)] = field.slice(equals + 1);
    offset += length;
  }
  return attributes;
}
export function safeArchivePath(path) {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').includes('..') ||
    /^[a-z]:/i.test(path)
  )
    throw new Error('Unsafe path in release archive.');
  return posix.normalize(path).replace(/^\.\//, '').replace(/\/$/, '') || '.';
}
export function archiveEntries(compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: LIMIT });
  const entries = [],
    seen = new Set();
  let pending = {},
    global = {},
    longPath,
    longLink;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (bytes.subarray(offset).some((byte) => byte !== 0))
        throw new Error('Unexpected bytes after the tar end marker.');
      break;
    }
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (number(header.subarray(148, 156)) !== checksum)
      throw new Error('Invalid tar checksum.');
    const size = number(header.subarray(124, 136));
    if (offset + 512 + size > bytes.length)
      throw new Error('Truncated tar archive.');
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    const type = string(header.subarray(156, 157)) || '0';
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pending = extended(content);
      continue;
    }
    if (type === 'g') {
      global = { ...global, ...extended(content) };
      continue;
    }
    if (type === 'L') {
      longPath = string(content);
      continue;
    }
    if (type === 'K') {
      longLink = string(content);
      continue;
    }
    const attributes = { ...global, ...pending };
    if (attributes.size !== undefined && Number(attributes.size) !== size)
      throw new Error('Conflicting extended tar size.');
    const prefix = string(header.subarray(345, 500));
    const path = safeArchivePath(
      attributes.path ??
        longPath ??
        (prefix ? prefix + '/' : '') + string(header.subarray(0, 100)),
    );
    const link =
      attributes.linkpath ?? longLink ?? string(header.subarray(157, 257));
    if (!['0', '5', '2', '1'].includes(type))
      throw new Error('Unsupported release archive entry.');
    if (seen.has(path)) throw new Error('Duplicate release archive entry.');
    seen.add(path);
    if (type === '2' || type === '1') {
      if (
        !link ||
        link.startsWith('/') ||
        link.includes('\\') ||
        link.includes('\0') ||
        /^[a-z]:/i.test(link)
      )
        throw new Error('Unsafe link in release archive.');
      safeArchivePath(
        type === '2' ? posix.join(posix.dirname(path), link) : link,
      );
    }
    entries.push({
      path,
      type,
      link,
      content,
      owner: attributes.uname ?? string(header.subarray(265, 297)),
      group: attributes.gname ?? string(header.subarray(297, 329)),
      metadata: JSON.stringify(attributes),
    });
    pending = {};
    longPath = undefined;
    longLink = undefined;
  }
  if (!entries.length) throw new Error('Empty release archive.');
  return entries;
}
