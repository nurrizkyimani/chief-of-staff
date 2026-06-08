import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../config/env.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";

const HTTP_URL_PREFIX_PATTERN = /^https?:\/\//i;
const MESSAGE_ID_SUFFIX_DISALLOWED_CHARACTER_PATTERN = /[^a-z0-9_-]+/g;

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const OPENCLAW_PLATFORM_ROOT = resolve(THIS_DIR, "../../..");
const OPENCLAW_HOME_ROOT = env.OPENCLAW_HOME
  ? resolve(env.OPENCLAW_HOME)
  : resolve(OPENCLAW_PLATFORM_ROOT, ".openclaw-home");

export type MediaCandidate = {
  url: string;
  mimeType?: string;
  sourceId?: string;
};

export type MediaReadResult = {
  binary: Buffer;
  mimeType: string;
  resolvedFrom: string;
};

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

function candidateLocalPaths(rawPath: string): string[] {
  const clean = rawPath.trim();
  if (!clean) return [];

  const normalized = clean.startsWith("file://") ? fileURLToPath(clean) : clean;
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

function sanitizeToken(value: string): string {
  const clean = value.toLowerCase().replace(MESSAGE_ID_SUFFIX_DISALLOWED_CHARACTER_PATTERN, "");
  return clean.slice(0, 24) || "media";
}

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
