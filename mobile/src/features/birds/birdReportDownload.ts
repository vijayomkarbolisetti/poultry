/**
 * Download a complete bird profile PDF from the authorized backend endpoint,
 * persist it on device, and optionally share/open it.
 */
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { api, describeApiError, tokenStore } from "../../api/client";
import {
  buildBirdReportFilename,
  filenameFromContentDisposition,
} from "./birdReportFilename";

export type BirdReportDownloadResult = {
  uri: string;
  filename: string;
  bytes: number;
};

export { buildBirdReportFilename };

function ensureReportsDir(): Directory {
  const dir = new Directory(Paths.document, "bird-reports");
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

/**
 * Fetch the PDF with the authenticated API client, write to app documents,
 * and verify the file exists with a non-zero size before returning success.
 */
export async function downloadBirdReportPdf(opts: {
  birdId: string;
  bandOrCode?: string | null;
}): Promise<BirdReportDownloadResult> {
  const fallbackName = buildBirdReportFilename(opts.bandOrCode);
  // Ensure tokens are hydrated for any follow-up share/open flows.
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
  const magic = String.fromCharCode(...new Uint8Array(data.slice(0, 4)));
  if (magic !== "%PDF") {
    throw new Error("Report download failed: server did not return a PDF.");
  }

  const filename = filenameFromContentDisposition(contentDisposition, fallbackName);
  const dir = ensureReportsDir();
  const file = new File(dir, filename);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      /* overwrite via write */
    }
  }
  try {
    if (!file.exists) {
      file.create({ intermediates: true });
    }
    file.write(new Uint8Array(data));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not save the report file.";
    throw new Error(msg);
  }

  if (!file.exists || (file.size ?? 0) < 5) {
    throw new Error("Report was generated but could not be saved on this device.");
  }

  return { uri: file.uri, filename: file.name, bytes: file.size ?? data.byteLength };
}

export async function shareBirdReport(uri: string, filename: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: filename,
    UTI: "com.adobe.pdf",
  });
}
