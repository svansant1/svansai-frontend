import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE = 25 * 1024 * 1024, MAX_PART = 12 * 1024 * 1024;
const MAX_EXPANDED = 48 * 1024 * 1024, MAX_ENTRIES = 2000;

/**
 * Bound actual decompression BEFORE Office libraries allocate their complete object graphs.
 * This is a package resource guard, not antivirus or a substitute for an isolated parser.
 * ZIP64, encryption, multidisk archives and nonstandard methods are explicitly unsupported.
 */
export function inspectOfficePackage(bytes: Buffer): void {
  const fail = () => { throw new Error("Office package is invalid or exceeds its safe parsing limits."); };
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE) fail();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) fail();
  const count = bytes.readUInt16LE(end + 10), centralBytes = bytes.readUInt32LE(end + 12), central = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 ||
      count !== bytes.readUInt16LE(end + 8) || !count || count > MAX_ENTRIES || central + centralBytes !== end) fail();
  let cursor = central, expanded = 0;
  const names = new Set<string>(), spans: { start: number; end: number }[] = [];
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20), expected = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extra + comment;
    if (next > end || flags & 1 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) !== 0 ||
        expected > MAX_PART || expanded + expected > MAX_EXPANDED || compressed > MAX_ARCHIVE || local + 30 > central) fail();
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = rawName.toString("utf8");
    if (!name || name.startsWith("/") || /[\\:\u0000]/.test(name) || name.split("/").some((part) => part === "..") || names.has(name)) fail();
    names.add(name);
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method ||
        bytes.readUInt16LE(local + 6) !== flags) fail();
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtra, stop = start + compressed;
    if (stop > central || localNameLength !== nameLength || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(rawName)) fail();
    spans.push({ start: local, end: stop });
    const payload = bytes.subarray(start, stop);
    // A dishonest central-directory size cannot bypass the native decompressor's output ceiling.
    const actual = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, Math.min(MAX_PART, MAX_EXPANDED - expanded)) });
    if (actual.length !== expected || actual.length > MAX_PART) fail();
    expanded += actual.length; cursor = next;
  }
  if (cursor !== end || !names.has("[Content_Types].xml")) fail();
  spans.sort((left, right) => left.start - right.start);
  for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) fail();
}
