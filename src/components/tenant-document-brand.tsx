export function TenantDocumentBrand({
  businessName,
  tagline,
  logoUrl,
  primaryColor,
  accentColor,
}: {
  businessName: string;
  tagline?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}) {
  const navy = primaryColor || "#12233F";
  const orange = accentColor || "#FF6A1A";
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={businessName} className="h-10 w-auto" />
      ) : (
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: orange }}>
          {businessName}
        </p>
      )}
      <div>
        {!logoUrl ? <p className="font-display text-xl" style={{ color: navy }}>{businessName}</p> : null}
        {tagline ? <p className="text-xs text-[var(--muted-foreground)]">{tagline}</p> : null}
      </div>
    </div>
  );
}
