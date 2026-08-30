import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { STARTER_TEMPLATES } from "@/lib/playbooks/templates";
import { createPlaybookAction, duplicatePlaybookAction, movePlaybookAction, updatePlaybookMetaAction } from "@/server/actions/playbooks";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

export default async function PlaybooksPage() {
  const ctx = await requirePermission("playbooks:view");
  const canManage = can(ctx.role, "playbooks:manage");
  const playbooks = await prisma.playbook.findMany({
    where: { companyId: ctx.company.id, status: { not: "ARCHIVED" } },
    orderBy: { sortOrder: "asc" },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      _count: { select: { jobs: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          Playbooks
        </h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Tell ContractorYou how each type of work should run. Your process. Your business. Your
          way.
        </p>
      </div>

      {canManage ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Create a playbook</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Start blank or from a starter. Starters are examples you can change.
          </p>
          <ActionForm action={createPlaybookAction} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="Residential Service" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="templateKey">Start from</Label>
                <select
                  id="templateKey"
                  name="templateKey"
                  className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
                >
                  <option value="">Blank playbook</option>
                  {STARTER_TEMPLATES.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Input name="description" placeholder="What kind of work is this for?" />
            <Button type="submit">Create playbook</Button>
          </ActionForm>
        </section>
      ) : null}

      {playbooks.length === 0 ? (
        <EmptyState
          title="No playbooks yet"
          description="Create one so technicians only see the steps this job needs. Existing jobs keep working without a playbook."
        />
      ) : (
        <ul className="space-y-3">
          {playbooks.map((playbook) => (
            <li
              key={playbook.id}
              className="rounded-2xl border border-[var(--border)] bg-white p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/settings/playbooks/${playbook.id}`}
                      className="text-lg font-semibold text-[var(--cy-navy)] hover:text-[var(--cy-orange)]"
                    >
                      {playbook.name}
                    </Link>
                    <StatusBadge status={playbook.status} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {playbook.description || "No description"}
                    {playbook.versions[0]
                      ? ` · Version ${playbook.versions[0].versionNumber}`
                      : ""}
                    {playbook._count.jobs > 0 ? ` · ${playbook._count.jobs} jobs` : ""}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={movePlaybookAction}>
                      <input type="hidden" name="playbookId" value={playbook.id} />
                      <input type="hidden" name="direction" value="up" />
                      <Button type="submit" variant="outline" size="sm">
                        Up
                      </Button>
                    </ActionForm>
                    <ActionForm action={movePlaybookAction}>
                      <input type="hidden" name="playbookId" value={playbook.id} />
                      <input type="hidden" name="direction" value="down" />
                      <Button type="submit" variant="outline" size="sm">
                        Down
                      </Button>
                    </ActionForm>
                    <ActionForm action={duplicatePlaybookAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="playbookId" value={playbook.id} />
                      <Input
                        name="name"
                        defaultValue={`${playbook.name} copy`}
                        className="h-8 w-44 text-sm"
                        aria-label="New playbook name"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Duplicate
                      </Button>
                    </ActionForm>
                    <ActionForm action={updatePlaybookMetaAction}>
                      <input type="hidden" name="playbookId" value={playbook.id} />
                      <input type="hidden" name="name" value={playbook.name} />
                      <input type="hidden" name="description" value={playbook.description ?? ""} />
                      <input
                        type="hidden"
                        name="status"
                        value={playbook.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        {playbook.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </Button>
                    </ActionForm>
                    <ActionForm action={updatePlaybookMetaAction}>
                      <input type="hidden" name="playbookId" value={playbook.id} />
                      <input type="hidden" name="name" value={playbook.name} />
                      <input type="hidden" name="description" value={playbook.description ?? ""} />
                      <input type="hidden" name="status" value="ARCHIVED" />
                      <Button type="submit" variant="outline" size="sm">
                        Archive
                      </Button>
                    </ActionForm>
                  </div>
                ) : (
                  <Link
                    href={`/settings/playbooks/${playbook.id}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    View
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
