/** Pure helpers for bird PDF report filenames (no React Native imports). */

function sanitizeFilenamePart(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unbanded";
}

export function buildBirdReportFilename(
  bandOrCode: string | null | undefined,
  when = new Date(),
): string {
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return `bird-report-${sanitizeFilenamePart(bandOrCode ?? "unbanded")}-${stamp}.pdf`;
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
