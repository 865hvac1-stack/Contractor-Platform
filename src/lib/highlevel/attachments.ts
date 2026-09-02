function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Provider recording/voicemail URLs are protected. Store presence only — never render the raw URL. */
export function extractHighLevelRecordingHint(attachments: unknown, metaRecordingUrl?: string | null) {
  const urls: string[] = [];
  if (Array.isArray(attachments)) {
    for (const item of attachments) {
      if (typeof item === "string" && item.trim()) urls.push(item.trim());
      else {
        const row = asRecord(item);
        const url = text(row.url) || text(row.href);
        if (url) urls.push(url);
      }
    }
  }
  if (metaRecordingUrl?.trim()) urls.push(metaRecordingUrl.trim());
  const recordingUrl = urls.find((url) => /record|voice|call|http/i.test(url)) ?? urls[0] ?? null;
  return {
    hasRecording: Boolean(recordingUrl),
    recordingUrl,
  };
}
