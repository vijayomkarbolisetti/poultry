/**
 * Download a complete bird profile PDF from the authorized backend endpoint,
 * persist it where the user can access it (Android SAF / folder picker),
 * and optionally share/open it from a cache copy.
 */
import { api, describeApiError, tokenStore } from "../../api/client";
import {
  FileSaveCancelledError,
  filenameFromContentDisposition,
  isFileSaveCancelled,
  saveBytesToUserFolder,
  shareLocalFile,
  writeBytesToCacheFile,
} from "../files/saveDownloadedFile";
import { buildBirdReportFilename } from "./birdReportFilename";

export type BirdReportDownloadResult = {
  uri: string;
  filename: string;
  bytes: number;
};

export { buildBirdReportFilename };
export {
  FileSaveCancelledError as BirdReportSaveCancelledError,
  isFileSaveCancelled as isBirdReportSaveCancelled,
};

type FetchedPdf = {
  data: Uint8Array;
  filename: string;
};

async function fetchBirdReportPdf(opts: {
  birdId: string;
  bandOrCode?: string | null;
}): Promise<FetchedPdf> {
  const fallbackName = buildBirdReportFilename(opts.bandOrCode);
  await tokenStore.hydrate();

  let data: ArrayBuffer;
  let contentDisposition: string | undefined;
  try {
    const resp = await api.get<ArrayBuffer>(`/birds/${opts.birdId}/vaccination-report.pdf`, {
      responseType: "arraybuffer",
      timeout: 120_000,
      headers: { Accept: "application/pdf" },
    });
    data = resp.data;
    contentDisposition = resp.headers?.["content-disposition"] as string | undefined;
  } catch (e: unknown) {
    throw new Error(describeApiError(e, "download bird report"));
  }

  if (!(data instanceof ArrayBuffer) || data.byteLength < 5) {
    throw new Error("Report download failed: empty or invalid file.");
  }
  const bytes = new Uint8Array(data);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "%PDF") {
    throw new Error("Report download failed: server did not return a PDF.");
  }

  return {
    data: bytes,
    filename: filenameFromContentDisposition(contentDisposition, fallbackName),
  };
}

/**
 * Fetch the PDF and save it into a user-chosen folder via the system document
 * tree picker (Android SAF / iOS document picker). No broad storage permission.
 */
export async function downloadBirdReportPdf(opts: {
  birdId: string;
  bandOrCode?: string | null;
}): Promise<BirdReportDownloadResult> {
  const { data, filename } = await fetchBirdReportPdf(opts);
  try {
    return await saveBytesToUserFolder({
      data,
      filename,
      mimeType: "application/pdf",
      extension: "pdf",
    });
  } catch (e: unknown) {
    if (isFileSaveCancelled(e)) {
      throw new FileSaveCancelledError();
    }
    throw e;
  }
}

/** Fetch the PDF into app cache for the share sheet (not user-visible Downloads). */
export async function prepareBirdReportForShare(opts: {
  birdId: string;
  bandOrCode?: string | null;
}): Promise<BirdReportDownloadResult> {
  const { data, filename } = await fetchBirdReportPdf(opts);
  return writeBytesToCacheFile({ data, filename, cacheSubdir: "bird-reports" });
}

export async function shareBirdReport(uri: string, filename: string): Promise<void> {
  await shareLocalFile({
    uri,
    filename,
    mimeType: "application/pdf",
    uti: "com.adobe.pdf",
  });
}
