/**
 * Fetch dead/sold bird list exports (CSV/XLSX) and save via SAF folder picker.
 */
import { api, describeApiError, tokenStore } from "../../api/client";
import {
  FileSaveCancelledError,
  filenameFromContentDisposition,
  isFileSaveCancelled,
  saveBytesToUserFolder,
  shareLocalFile,
  writeBytesToCacheFile,
  type SavedDownloadResult,
} from "../files/saveDownloadedFile";
import { type BirdListExportRange } from "./birdListExportRanges";

export type BirdListExportKind = "dead" | "sold";
export type BirdListExportFormat = "csv" | "xlsx";
export type { BirdListExportRange };
export { exportPeriodRange } from "./birdListExportRanges";

const MIME: Record<BirdListExportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function fallbackFilename(
  kind: BirdListExportKind,
  format: BirdListExportFormat,
  range: BirdListExportRange,
): string {
  const prefix = kind === "dead" ? "dead-birds" : "sold-birds";
  const span =
    range.from && range.to
      ? `${range.from}_to_${range.to}`
      : range.from
        ? `from_${range.from}`
        : range.to
          ? `to_${range.to}`
          : "all";
  return `${prefix}-${span}.${format}`;
}

async function fetchExportBytes(opts: {
  kind: BirdListExportKind;
  format: BirdListExportFormat;
  range: BirdListExportRange;
}): Promise<{ data: Uint8Array; filename: string }> {
  await tokenStore.hydrate();
  const path = opts.kind === "dead" ? "/birds/dead-birds/export" : "/birds/sold/export";
  const params =
    opts.kind === "dead"
      ? {
          format: opts.format,
          died_from: opts.range.from || undefined,
          died_to: opts.range.to || undefined,
        }
      : {
          format: opts.format,
          sold_from: opts.range.from || undefined,
          sold_to: opts.range.to || undefined,
        };

  const accept =
    opts.format === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  let data: ArrayBuffer;
  let contentDisposition: string | undefined;
  try {
    const resp = await api.get<ArrayBuffer>(path, {
      params,
      responseType: "arraybuffer",
      timeout: 120_000,
      headers: { Accept: accept },
    });
    data = resp.data;
    contentDisposition = resp.headers?.["content-disposition"] as string | undefined;
  } catch (e: unknown) {
    throw new Error(describeApiError(e, "download export"));
  }

  if (!(data instanceof ArrayBuffer) || data.byteLength < 1) {
    throw new Error("Export download failed: empty or invalid file.");
  }

  return {
    data: new Uint8Array(data),
    filename: filenameFromContentDisposition(
      contentDisposition,
      fallbackFilename(opts.kind, opts.format, opts.range),
    ),
  };
}

export async function downloadBirdListExport(opts: {
  kind: BirdListExportKind;
  format: BirdListExportFormat;
  range: BirdListExportRange;
}): Promise<SavedDownloadResult> {
  const { data, filename } = await fetchExportBytes(opts);
  try {
    return await saveBytesToUserFolder({
      data,
      filename,
      mimeType: MIME[opts.format],
      extension: opts.format,
    });
  } catch (e: unknown) {
    if (isFileSaveCancelled(e)) {
      throw new FileSaveCancelledError();
    }
    throw e;
  }
}

/**
 * Fetch the export into app cache and open the system share sheet.
 * This bypasses Android SAF folder restrictions entirely, so the user can
 * save/send the file even when the folder picker refuses a location.
 */
export async function shareBirdListExport(opts: {
  kind: BirdListExportKind;
  format: BirdListExportFormat;
  range: BirdListExportRange;
}): Promise<SavedDownloadResult> {
  const { data, filename } = await fetchExportBytes(opts);
  const prepared = await writeBytesToCacheFile({
    data,
    filename,
    cacheSubdir: "bird-list-exports",
  });
  await shareLocalFile({
    uri: prepared.uri,
    filename: prepared.filename,
    mimeType: MIME[opts.format],
  });
  return prepared;
}

export { FileSaveCancelledError, isFileSaveCancelled };
