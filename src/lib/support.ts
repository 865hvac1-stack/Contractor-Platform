/**
 * Public support contact used on legal and help surfaces.
 * Prefer NEXT_PUBLIC_SUPPORT_EMAIL or SUPPORT_EMAIL when a ContractorYou inbox exists.
 * TODO: replace the 865 HVAC fallback with a ContractorYou support address before public launch.
 */
export const FALLBACK_SUPPORT_EMAIL = "865hvac@gmail.com";

export function supportEmail() {
  return (
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
    process.env.SUPPORT_EMAIL?.trim() ||
    FALLBACK_SUPPORT_EMAIL
  );
}

export function supportMailto() {
  return `mailto:${supportEmail()}`;
}
