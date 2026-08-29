import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { ROLE_LABELS, can } from "@/lib/permissions";
import {
  inviteTeamMemberAction,
  updateMemberRoleAction,
} from "@/server/actions/team";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CompanyRole } from "@prisma/client";

const INVITE_ROLES: CompanyRole[] = [
  "ADMIN",
  "OFFICE",
  "DISPATCHER",
  "SALES",
  "TECHNICIAN",
  "INSTALLER",
  "MANAGER",
];

export default async function TeamPage() {
  const ctx = await requirePermission("team:view");
  const canManage = can(ctx.role, "team:manage");

  const members = await prisma.membership.findMany({
    where: { companyId: ctx.company.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          People with access to {ctx.company.businessName}.
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="No team members"
          description="Invite office staff, technicians, or managers to collaborate."
        />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead>Change role</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.user.firstName} {m.user.lastName}
                  </TableCell>
                  <TableCell>{m.user.email}</TableCell>
                  <TableCell>{ROLE_LABELS[m.role]}</TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} />
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      {m.role === "COMPANY_OWNER" ? (
                        <span className="text-xs text-[var(--muted-foreground)]">Owner</span>
                      ) : (
                        <form
                          action={async (formData) => {
                            "use server";
                            const role = String(formData.get("role") || "");
                            await updateMemberRoleAction(m.id, role);
                          }}
                          className="flex items-center gap-2"
                        >
                          <select
                            name="role"
                            defaultValue={m.role}
                            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                          >
                            {INVITE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="sm" variant="outline">
                            Save
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage ? (
        <ActionForm
          action={inviteTeamMemberAction}
          successMessage="Team member invited."
          className="mx-auto max-w-xl space-y-4 rounded-xl border border-[var(--border)] bg-white p-6"
        >
          <h2 className="font-display text-xl">Invite member</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                required
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                defaultValue="TECHNICIAN"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="temporaryPassword">Temporary password</Label>
              <Input
                id="temporaryPassword"
                name="temporaryPassword"
                type="password"
                required
                minLength={10}
              />
            </div>
          </div>
          <Button type="submit">Send invite</Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
