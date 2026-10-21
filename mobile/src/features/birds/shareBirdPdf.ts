import { EncodingType, cacheDirectory, writeAsStringAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // React Native provides btoa in many runtimes; fall back to manual alphabet if needed.
  if (typeof btoa === "function") return btoa(binary);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let out = "";
  for (let i = 0; i < binary.length; ) {
    const c1 = binary.charCodeAt(i++);
    const c2 = binary.charCodeAt(i++);
    const c3 = binary.charCodeAt(i++);
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    const e3 = Number.isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
    const e4 = Number.isNaN(c3) ? 64 : c3 & 63;
    out += chars.charAt(e1) + chars.charAt(e2) + chars.charAt(e3) + chars.charAt(e4);
  }
  return out;
}

export async function shareBirdPdf(opts: { bytes: ArrayBuffer; filename: string }): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  const base = cacheDirectory;
  if (!base) throw new Error("Cache directory is unavailable.");
  const safeName = opts.filename.replace(/[^\w.\-]+/g, "_");
  const uri = `${base}${safeName}`;
  const b64 = arrayBufferToBase64(opts.bytes);
  await writeAsStringAsync(uri, b64, { encoding: EncodingType.Base64 });
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: "Bird vaccination report",
    UTI: "com.adobe.pdf",
  });
}
