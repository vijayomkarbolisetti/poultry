/**
 * Save binary downloads into a user-chosen folder (Android SAF / iOS document picker).
 * Shared by bird PDF reports and dead/sold list CSV/XLSX exports.
 */
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export class FileSaveCancelledError extends Error {
  constructor(message = "Save cancelled — no folder was selected.") {
    super(message);
    this.name = "FileSaveCancelledError";
  }
}

export function isFileSaveCancelled(error: unknown): boolean {
  if (error instanceof FileSaveCancelledError) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /cancel/i.test(msg);
}

export type SavedDownloadResult = {
  uri: string;
  filename: string;
  bytes: number;
};

function writeBytesToFile(file: File, data: Uint8Array): void {
  try {
    if (!file.exists) {
      file.create({ intermediates: true });
    }
    file.write(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not save the file.";
    throw new Error(msg);
  }
  if (!file.exists || (file.size ?? 0) < 1) {
    throw new Error("File was generated but could not be saved on this device.");
  }
}

/** Strip a known extension so SAF MIME handling does not double the suffix. */
function safDisplayName(filename: string, extension: string): string {
  const lower = filename.toLowerCase();
  const ext = extension.toLowerCase().replace(/^\./, "");
  const suffix = `.${ext}`;
  return lower.endsWith(suffix) ? filename.slice(0, -suffix.length) : filename;
}

function ensureExtension(name: string, extension: string): string {
  const ext = extension.replace(/^\./, "");
  return name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? name : `${name}.${ext}`;
}

/**
 * Pick a folder and write bytes. Success only after the write is verified.
 */
export async function saveBytesToUserFolder(opts: {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  /** File extension without leading dot, used for SAF display name / final name. */
  extension: string;
}): Promise<SavedDownloadResult> {
  let destination: Directory;
  try {
    destination = await Directory.pickDirectoryAsync();
  } catch (e: unknown) {
    if (isFileSaveCancelled(e)) {
      throw new FileSaveCancelledError();
    }
    const msg = e instanceof Error ? e.message : "Could not open the folder picker.";
    throw new Error(msg);
  }

  let file: File;
  try {
    file = destination.createFile(safDisplayName(opts.filename, opts.extension), opts.mimeType);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not create the file in the selected folder.";
    throw new Error(msg);
  }

  writeBytesToFile(file, opts.data);

  const savedName = file.name || opts.filename;
  return {
    uri: file.uri,
    filename: ensureExtension(savedName, opts.extension),
    bytes: file.size ?? opts.data.byteLength,
  };
}

/** Write into app cache (for share sheet), not user-visible Downloads. */
export async function writeBytesToCacheFile(opts: {
  data: Uint8Array;
  filename: string;
  cacheSubdir: string;
}): Promise<SavedDownloadResult> {
  const dir = new Directory(Paths.cache, opts.cacheSubdir);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const file = new File(dir, opts.filename);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      /* overwrite via write */
    }
  }
  writeBytesToFile(file, opts.data);
  return { uri: file.uri, filename: file.name, bytes: file.size ?? opts.data.byteLength };
}

export async function shareLocalFile(opts: {
  uri: string;
  filename: string;
  mimeType: string;
  uti?: string;
}): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(opts.uri, {
    mimeType: opts.mimeType,
    dialogTitle: opts.filename,
    UTI: opts.uti,
  });
}

export function filenameFromContentDisposition(
  header: string | undefined,
  fallback: string,
): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* keep fallback path */
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header);
  const raw = (plain?.[1] ?? plain?.[2] ?? "").trim();
  if (!raw) return fallback;
  return raw.replace(/[^\w.\-]+/g, "-") || fallback;
}
