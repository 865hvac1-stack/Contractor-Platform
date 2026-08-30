/**
 * Intelligence and marketing queries must inject the authenticated company id.
 * Never accept a browser-supplied companyId as the sole scope.
 */
export function scopedCompanyWhere<T extends object>(
  companyId: string,
  extra?: T
): T & { companyId: string } {
  return { ...(extra ?? ({} as T)), companyId };
}

export function assertSameCompany(expectedCompanyId: string, recordCompanyId: string | null | undefined) {
  if (!recordCompanyId || recordCompanyId !== expectedCompanyId) {
    throw new Error("Tenant scope mismatch.");
  }
}
