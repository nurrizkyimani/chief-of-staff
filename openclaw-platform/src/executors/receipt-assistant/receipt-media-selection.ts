import {
  normalizeMimeType,
  type MediaCandidate
} from "../../integrations/openclaw/media-source.js";

export type ReceiptMediaSelection = {
  candidates: MediaCandidate[];
  skippedPdfCount: number;
};

export function selectReceiptMediaCandidates(mediaCandidates: MediaCandidate[]): ReceiptMediaSelection {
  const hintedImages = mediaCandidates.filter((media) =>
    normalizeMimeType(media.mimeType, media.url).startsWith("image/")
  );
  const hintedPdfs = mediaCandidates.filter((media) =>
    normalizeMimeType(media.mimeType, media.url) === "application/pdf"
  );
  const hintedUnknown = mediaCandidates.filter((media) => {
    const mime = normalizeMimeType(media.mimeType, media.url);
    return !mime.startsWith("image/") && mime !== "application/pdf";
  });

  return {
    candidates: hintedImages.length > 0 ? [...hintedImages, ...hintedUnknown] : mediaCandidates,
    skippedPdfCount: hintedImages.length > 0 ? hintedPdfs.length : 0
  };
}
