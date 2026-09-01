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
