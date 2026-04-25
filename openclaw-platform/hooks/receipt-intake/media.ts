import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../dist/config/env.js";
import { ReceiptError, getErrorStatus } from "../../dist/errors/receipt_errors.js";
import {
  HTTP_URL_IN_TEXT_PATTERN,
  HTTP_URL_PREFIX_PATTERN,
  MESSAGE_ID_SUFFIX_DISALLOWED_CHARACTER_PATTERN,
  OPENCLAW_HOME_ROOT,
  OPENCLAW_PLATFORM_ROOT
} from "./constants.js";
import type { MediaCandidate, MediaReadResult } from "./types.js";

// normalizeMimeType resolves a media MIME type from metadata or URL.
export function normalizeMimeType(candidateMime: string | undefined, url: string): string {
  const fromCandidate = String(candidateMime ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (fromCandidate) return fromCandidate;

  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith(".pdf")) return "application/pdf";
  if (lowerUrl.endsWith(".png")) return "image/png";
  if (lowerUrl.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

// candidateLocalPaths builds possible filesystem paths for local media.
function candidateLocalPaths(rawPath: string): string[] {
  const clean = rawPath.trim();
  if (!clean) return [];

  const normalized = clean.startsWith("file://")
    ? fileURLToPath(clean)
    : clean;

  const paths = new Set<string>();
  if (isAbsolute(normalized)) {
    paths.add(normalized);
  } else {
    paths.add(resolve(process.cwd(), normalized));
    paths.add(resolve(OPENCLAW_PLATFORM_ROOT, normalized));
    paths.add(resolve(OPENCLAW_HOME_ROOT, normalized));
    paths.add(resolve(OPENCLAW_HOME_ROOT, ".openclaw", normalized));
    paths.add(resolve(OPENCLAW_HOME_ROOT, ".openclaw", "workspace", normalized));
  }

  return [...paths];
}

// readMediaCandidate downloads or reads a media candidate.
export async function readMediaCandidate(media: MediaCandidate): Promise<MediaReadResult> {
  if (HTTP_URL_PREFIX_PATTERN.test(media.url)) {
    const response = await fetch(media.url);
    if (!response.ok) {
      throw new ReceiptError("MEDIA_FETCH", "Could not download media.", {
        status: response.status
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      binary: Buffer.from(arrayBuffer),
      mimeType: normalizeMimeType(media.mimeType ?? response.headers.get("content-type") ?? undefined, media.url),
      resolvedFrom: media.url
    };
  }

  const attempts = candidateLocalPaths(media.url);
  let lastError: unknown;
  for (const candidatePath of attempts) {
    try {
      return {
        binary: await readFile(candidatePath),
        mimeType: normalizeMimeType(media.mimeType, candidatePath),
        resolvedFrom: candidatePath
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new ReceiptError("MEDIA_FETCH", "Could not read local media file.", {
    cause: lastError,
    status: getErrorStatus(lastError)
  });
}

// sanitizeToken creates a safe suffix for message ids.
function sanitizeToken(value: string): string {
  const clean = value.toLowerCase().replace(MESSAGE_ID_SUFFIX_DISALLOWED_CHARACTER_PATTERN, "");
  return clean.slice(0, 24) || "media";
}

// deriveMessageId builds a stable id for a media item or PDF page.
export function deriveMessageId(
  baseMessageId: string,
  candidate: MediaCandidate,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const hasMany = totalMedia > 1 || totalPages > 1;
  if (!hasMany && !candidate.sourceId) return baseMessageId;

  const mediaSuffix = candidate.sourceId ? sanitizeToken(candidate.sourceId) : `m${mediaIndex + 1}`;
  if (totalPages > 1) {
    return `${baseMessageId}:${mediaSuffix}:p${pageNumber}`;
  }
  return `${baseMessageId}:${mediaSuffix}`;
}

// collectMediaCandidates extracts receipt media attachments from an event.
export function collectMediaCandidates(event: any, text: string): MediaCandidate[] {
  const metadata = event?.context?.metadata ?? {};
  const context = event?.context ?? {};
  const collected: MediaCandidate[] = [];

  // addCandidate adds one raw media-like value to the candidate list.
  const addCandidate = (raw: unknown): void => {
    if (!raw) return;

    if (Array.isArray(raw)) {
      raw.forEach(addCandidate);
      return;
    }

    if (typeof raw === "string") {
      collected.push({ url: raw });
      return;
    }

    if (typeof raw !== "object") return;

    const candidate = raw as Record<string, unknown>;
    const urlValue =
      candidate.url ??
      candidate.mediaUrl ??
      candidate.attachmentUrl ??
      candidate.fileUrl ??
      candidate.downloadUrl ??
      candidate.filePath ??
      candidate.path ??
      candidate.mediaPath;

    if (typeof urlValue !== "string" || !urlValue) return;

    const mimeTypeValue = candidate.mimeType ?? candidate.contentType ?? candidate.type;
    const sourceIdValue = candidate.fileId ?? candidate.mediaId ?? candidate.id ?? candidate.telegramFileId;

    collected.push({
      url: urlValue,
      mimeType: typeof mimeTypeValue === "string" ? mimeTypeValue : undefined,
      sourceId: sourceIdValue !== undefined ? String(sourceIdValue) : undefined
    });
  };

  addCandidate(metadata.mediaUrl);
  addCandidate(metadata.attachmentUrl);
  addCandidate(metadata.fileUrl);
  addCandidate(metadata.media);
  addCandidate(metadata.mediaUrls);
  addCandidate(metadata.attachments);

  addCandidate(context.media);
  addCandidate(context.attachment);
  addCandidate(context.attachments);
  addCandidate(
    context.mediaPath
      ? {
          mediaPath: context.mediaPath,
          mimeType: context.mediaType,
          id: context.messageId
        }
      : undefined
  );

  const unique = new Map<string, MediaCandidate>();
  for (const item of collected) {
    const dedupeKey = `${item.url}::${item.sourceId ?? ""}`;
    if (!unique.has(dedupeKey)) {
      unique.set(dedupeKey, item);
    }
  }

  if (unique.size === 0) {
    const urlMatches = [...text.matchAll(HTTP_URL_IN_TEXT_PATTERN)].map((match) => match[0]);
    for (const url of urlMatches) {
      const key = `${url}::`;
      if (!unique.has(key)) {
        unique.set(key, { url });
      }
    }
  }

  return [...unique.values()];
}

// isPdfDisabled checks whether PDF intake is disabled by configuration.
export function isPdfDisabled(): boolean {
  return env.RECEIPT_STRICT_MEMORY_ONLY || !env.RECEIPT_ACCEPT_PDF;
}
