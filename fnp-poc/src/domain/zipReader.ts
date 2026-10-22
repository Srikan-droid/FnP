/**
 * A minimal ZIP reader built on the browser's own DecompressionStream, so the app keeps its
 * three runtime dependencies. It reads the central directory rather than scanning local
 * headers, which is what lets it report a file's real size before inflating it.
 *
 * Handles the two methods real archives use: stored (0) and deflate (8). Anything else is
 * reported rather than silently dropped, as are encrypted entries.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

export interface ZipEntry {
  /** Path as stored in the archive, directories included. */
  path: string;
  /** Just the file name, without any directory part. */
  name: string;
  /** Lower-case extension without the dot, or "" when there is none. */
  extension: string;
  size: number;
  bytes: Uint8Array;
}

export interface ZipReadResult {
  entries: ZipEntry[];
  /** Entries that could not be read, with the reason, so nothing vanishes silently. */
  skipped: { path: string; reason: string }[];
}

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD sits at the end, after a comment of at most 64 KiB.
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - maxComment - 22);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

async function inflate(bytes: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`unsupported compression method ${method}`);

  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export async function readZip(file: File | Blob): Promise<ZipReadResult> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd === -1) throw new Error("This does not look like a ZIP file.");

  // Zip64 archives put the real counts elsewhere; the POC does not need them, but it should
  // say so rather than reading the truncated 32-bit values and producing nonsense.
  const locator = eocd - 20;
  if (locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) {
    throw new Error("Zip64 archives are not supported.");
  }

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  const skipped: ZipReadResult["skipped"] = [];

  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    // Bit 11 marks UTF-8; older archives use CP437, which overlaps ASCII for ordinary names.
    const path = new TextDecoder("utf-8").decode(rawName);
    offset += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry a trailing slash and no content.
    if (path.endsWith("/")) continue;
    // Skip the metadata folder macOS adds when compressing from Finder.
    if (path.startsWith("__MACOSX/") || path.split("/").pop()?.startsWith("._")) continue;

    if (flags & 0x1) {
      skipped.push({ path, reason: "encrypted" });
      continue;
    }

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      skipped.push({ path, reason: "the archive index points at a damaged entry" });
      continue;
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    try {
      const content = await inflate(compressed, method);
      const name = path.split("/").pop() ?? path;
      entries.push({
        path,
        name,
        extension: extensionOf(name),
        size: uncompressedSize || content.byteLength,
        bytes: content,
      });
    } catch (error) {
      skipped.push({
        path,
        reason: error instanceof Error ? error.message : "could not be decompressed",
      });
    }
  }

  return { entries, skipped };
}
