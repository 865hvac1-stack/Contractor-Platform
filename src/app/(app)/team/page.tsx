import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { ROLE_LABELS, can } from "@/lib/permissions";
import {
  inviteTeamMemberAction,
  resendTeamInviteAction,
  revokeTeamInviteAction,
  updateMemberRoleAction,
} from "@/server/actions/team";
import { inviteStatus } from "@/lib/team/invite-status";
import { emailConfigured } from "@/lib/email/resend";
import { updateLaborCostAction } from "@/server/actions/costing";
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
  const canLabor = can(ctx.role, "job_costs:manage");

  const [members, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId: ctx.company.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.teamInvite.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const emailReady = emailConfigured();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          People with access to {ctx.company.businessName}.
          {canLabor
            ? " Loaded labor cost is office-only and used later for job costing. It is not payroll and is never shown to technicians."
            : ""}
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
                {canLabor ? <TableHead>Loaded labor / hr</TableHead> : null}
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
                  {canLabor ? (
                    <TableCell>
                      <ActionForm action={updateLaborCostAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.userId} />
                        <Input
                          name="loadedLaborCost"
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 w-24"
                          defaultValue={
                            m.user.loadedLaborCostCents != null
                              ? (m.user.loadedLaborCostCents / 100).toFixed(2)
                              : ""
                          }
                          placeholder="—"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Save
                        </Button>
                      </ActionForm>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage ? (
        <section className="space-y-3">
          <h2 className="font-display text-xl">Invitations</h2>
          {!emailReady ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Email is not configured. Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> (or{" "}
              <code>RESEND_FROM</code>) on the server. Invites can be saved, but ContractorYou will not say they were
              sent.
            </p>
          ) : null}
          {invites.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No invitations yet.</p>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => {
                    const status = inviteStatus(invite);
                    return (
                      <TableRow key={invite.id}>
                        <TableCell className="font-medium">
                          {invite.firstName} {invite.lastName}
                        </TableCell>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell>{ROLE_LABELS[invite.role]}</TableCell>
                        <TableCell>
                          <StatusBadge status={status} />
                        </TableCell>
                        <TableCell className="text-xs text-[var(--muted-foreground)]">
                          {invite.lastEmailStatus === "sent"
                            ? "Sent"
                            : invite.lastEmailStatus === "not_configured"
                              ? "Not configured"
                              : invite.lastEmailStatus === "failed"
                                ? "Failed"
                                : "—"}
                        </TableCell>
                        <TableCell>
                          {status === "PENDING" || status === "EXPIRED" ? (
                            <div className="flex flex-wrap gap-2">
                              <form
                                action={async () => {
                                  "use server";
                                  await resendTeamInviteAction(invite.id);
                                }}
                              >
                                <Button type="submit" size="sm" variant="outline">
                                  Resend
                                </Button>
                              </form>
                              {status === "PENDING" ? (
                                <form
                                  action={async () => {
                                    "use server";
                                    await revokeTeamInviteAction(invite.id);
                                  }}
                                >
                                  <Button type="submit" size="sm" variant="ghost">
                                    Revoke
                                  </Button>
                                </form>
                              ) : null}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}

      {canManage ? (
        <ActionForm
          action={inviteTeamMemberAction}
          className="mx-auto max-w-xl space-y-4 rounded-xl border border-[var(--border)] bg-white p-6"
        >
          <h2 className="font-display text-xl">Invite member</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Sends a secure setup link. ContractorYou does not create a second account when you resend.
          </p>
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                name="role"
                required
                className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                defaultValue="TECHNICIAN"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit">Send invite email</Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
