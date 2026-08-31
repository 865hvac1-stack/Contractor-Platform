export const JOB_PHOTO_KINDS = [
  { value: "BEFORE", label: "Before" },
  { value: "AFTER", label: "After" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "DATA_PLATE", label: "Data plate / model-serial" },
  { value: "DIAGNOSTIC", label: "Diagnostic / problem" },
  { value: "REPAIR", label: "Repair / work performed" },
  { value: "WARRANTY", label: "Warranty" },
  { value: "RECEIPT", label: "Receipt / part" },
  { value: "OTHER", label: "Other" },
] as const;

export function isJobPhotoKind(value: string) {
  return JOB_PHOTO_KINDS.some((kind) => kind.value === value);
}

export function looksLikeImage(file: { type: string; name: string }) {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name);
}
