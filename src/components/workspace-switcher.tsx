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
    <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--muted)] p-1">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={`inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold ${
            current === item.id ? "bg-[var(--cy-navy)] text-white" : "text-[var(--muted-foreground)]"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
