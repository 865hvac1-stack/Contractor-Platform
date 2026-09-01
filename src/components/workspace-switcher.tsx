import Link from "next/link";
import { WORKSPACES, type WorkspaceId } from "@/lib/workspaces";

export function WorkspaceSwitcher({
  current,
  allowed,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
}) {
  const items = WORKSPACES.filter((item) => allowed.includes(item.id) && item.id !== "field");
  if (items.length < 2) return null;
  return (
    <div className="hidden min-w-0 md:flex md:flex-nowrap md:gap-1 md:rounded-xl md:bg-[var(--muted)] md:p-1">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={`inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-xs font-semibold ${
            current === item.id ? "bg-[var(--cy-navy)] text-white" : "text-[var(--muted-foreground)]"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function MobileWorkspaceLinks({
  current,
  allowed,
  onNavigate,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  onNavigate?: () => void;
}) {
  const items = WORKSPACES.filter((item) => allowed.includes(item.id) && item.id !== "field");
  if (items.length === 0) return null;
  return (
    <div className="px-3 pb-3">
      <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Workspace</p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={onNavigate}
            className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${
              current === item.id ? "bg-white/8 text-white" : "text-white/65 hover:bg-white/6 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
