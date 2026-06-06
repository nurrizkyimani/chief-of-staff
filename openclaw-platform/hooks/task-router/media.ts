import type { MediaCandidate } from "../../dist/integrations/openclaw/media-source.js";

const HTTP_URL_IN_TEXT_PATTERN = /https?:\/\/\S+/g;

export function collectMediaCandidates(event: any, text: string): MediaCandidate[] {
  const metadata = event?.context?.metadata ?? {};
  const context = event?.context ?? {};
  const collected: MediaCandidate[] = [];

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
