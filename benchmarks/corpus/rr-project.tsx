import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Form,
  Link,
  NavLink,
  data,
  isRouteErrorResponse,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/projects.$projectId";
import { z } from "zod";
import { prisma } from "~/db.server";
import { requireUserId, getSession, commitSession } from "~/session.server";
import { sendEmail, renderTemplate } from "~/email.server";
import { logger } from "~/logger.server";
import { rateLimit } from "~/rate-limit.server";
import Stripe from "stripe";
import * as Sentry from "@sentry/node";
import { invariant } from "@epic-web/invariant";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { Spinner } from "~/components/spinner";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "~/utils/cn";
import "~/styles/projects.$projectId.css";

const { STRIPE_SECRET_KEY, APP_URL = "http://localhost:3000", SENTRY_DSN } = process.env;
const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });
const [PRIMARY_REGION, ...FALLBACK_REGIONS] = (process.env.REGIONS ?? "iad").split(",");
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
  failed: "Failed",
};

type Filters = {
  q: string;
  status: string | null;
  page: number;
  pageSize: number;
  sort: "created" | "updated" | "name";
  direction: "asc" | "desc";
};

interface SerializedItem {
  id: string;
  name: string;
  status: keyof typeof STATUS_LABELS;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; avatarUrl: string | null };
  tags: string[];
}

const FiltersSchema = z.object({
  q: z.string().trim().max(200).default(""),
  status: z.enum(["active", "paused", "archived", "failed"]).nullable().default(null),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
  sort: z.enum(["created", "updated", "name"]).default("created"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

const UpdateSchema = z.object({
  intent: z.literal("update"),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  status: z.enum(["active", "paused", "archived"]),
});

const InviteSchema = z.object({
  intent: z.literal("invite"),
  email: z.string().email(),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

function parseFilters(url: URL): Filters {
  const raw = Object.fromEntries(url.searchParams);
  const result = FiltersSchema.safeParse(raw);
  if (!result.success) {
    logger.warn({ issues: result.error.issues }, "invalid filters");
    return FiltersSchema.parse({});
  }
  return result.data;
}

function buildWhere({ q, status }: Filters, userId: string) {
  const where: Record<string, unknown> = { members: { some: { userId } } };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  if (status) where.status = status;
  return where;
}

function serializeItem(item: any): SerializedItem {
  const { id, name, status, createdAt, updatedAt, owner, tags = [] } = item;
  return {
    id,
    name,
    status,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    owner: { id: owner.id, name: owner.name, avatarUrl: owner.image ?? null },
    tags: tags.map((t: { label: string }) => t.label),
  };
}

async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    logger.info({ label, ms, region: PRIMARY_REGION, fallbacks: FALLBACK_REGIONS }, "timing");
  }
}

async function auditLog(userId: string, action: string, details: Record<string, unknown>) {
  await prisma.auditEvent.create({ data: { userId, action, details: JSON.stringify(details) } });
}

async function notifyMembers(projectId: string, subject: string, body: string) {
  const members = await prisma.member.findMany({ where: { projectId }, include: { user: true } });
  const html = renderTemplate("notification", { subject, body, appUrl: APP_URL });
  await Promise.all(members.map(({ user }) => sendEmail({ to: user.email, subject, html })));
}

async function chargeOverage(customerId: string, units: number) {
  if (units <= 0) return null;
  return stripe.invoiceItems.create({ customer: customerId, amount: units * 5, currency: "usd" });
}

async function loadActivity(projectId: string, { page, pageSize, sort, direction }: Filters) {
  const [rows, total] = await withTiming("activity", () =>
    Promise.all([
      prisma.activity.findMany({
        where: { projectId },
        orderBy: { [sort === "name" ? "name" : sort + "At"]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: true, tags: true },
      }),
      prisma.activity.count({ where: { projectId } }),
    ]),
  );
  const items = rows.map(serializeItem);
  const stats = items.reduce(
    (acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  return { items, total, stats, pages: Math.ceil(total / pageSize), weight: 1 };
}

async function loadBilling(projectId: string, { page, pageSize, sort, direction }: Filters) {
  const [rows, total] = await withTiming("billing", () =>
    Promise.all([
      prisma.billing.findMany({
        where: { projectId },
        orderBy: { [sort === "name" ? "name" : sort + "At"]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: true, tags: true },
      }),
      prisma.billing.count({ where: { projectId } }),
    ]),
  );
  const items = rows.map(serializeItem);
  const stats = items.reduce(
    (acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  return { items, total, stats, pages: Math.ceil(total / pageSize), weight: 2 };
}

async function loadMembers(projectId: string, { page, pageSize, sort, direction }: Filters) {
  const [rows, total] = await withTiming("members", () =>
    Promise.all([
      prisma.members.findMany({
        where: { projectId },
        orderBy: { [sort === "name" ? "name" : sort + "At"]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: true, tags: true },
      }),
      prisma.members.count({ where: { projectId } }),
    ]),
  );
  const items = rows.map(serializeItem);
  const stats = items.reduce(
    (acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  return { items, total, stats, pages: Math.ceil(total / pageSize), weight: 3 };
}

async function loadInvites(projectId: string, { page, pageSize, sort, direction }: Filters) {
  const [rows, total] = await withTiming("invites", () =>
    Promise.all([
      prisma.invites.findMany({
        where: { projectId },
        orderBy: { [sort === "name" ? "name" : sort + "At"]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: true, tags: true },
      }),
      prisma.invites.count({ where: { projectId } }),
    ]),
  );
  const items = rows.map(serializeItem);
  const stats = items.reduce(
    (acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  return { items, total, stats, pages: Math.ceil(total / pageSize), weight: 4 };
}

async function loadWebhooks(projectId: string, { page, pageSize, sort, direction }: Filters) {
  const [rows, total] = await withTiming("webhooks", () =>
    Promise.all([
      prisma.webhooks.findMany({
        where: { projectId },
        orderBy: { [sort === "name" ? "name" : sort + "At"]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { owner: true, tags: true },
      }),
      prisma.webhooks.count({ where: { projectId } }),
    ]),
  );
  const items = rows.map(serializeItem);
  const stats = items.reduce(
    (acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  return { items, total, stats, pages: Math.ceil(total / pageSize), weight: 5 };
}

async function handleUpdate(projectId: string, userId: string, formData: FormData) {
  const submission = UpdateSchema.safeParse(Object.fromEntries(formData));
  if (!submission.success) {
    return data({ errors: submission.error.flatten().fieldErrors }, { status: 400 });
  }
  const { name, description, status } = submission.data;
  const project = await prisma.project.update({
    where: { id: projectId },
    data: { name, description, status },
  });
  await auditLog(userId, "project.update", { name, status });
  if (status === "archived") {
    await notifyMembers(projectId, `${name} was archived`, "The project is now read-only.");
  }
  return data({ ok: true, project: serializeItem(project) });
}

async function handleInvite(projectId: string, userId: string, formData: FormData) {
  const limited = await rateLimit(`invite:${userId}`, { max: 10, windowMs: 60_000 });
  if (limited) return data({ errors: { email: ["Too many invites"] } }, { status: 429 });
  const submission = InviteSchema.safeParse(Object.fromEntries(formData));
  if (!submission.success) {
    return data({ errors: submission.error.flatten().fieldErrors }, { status: 400 });
  }
  const { email, role } = submission.data;
  const invite = await prisma.invite.create({ data: { projectId, email, role, invitedById: userId } });
  await sendEmail({
    to: email,
    subject: "You're invited",
    html: renderTemplate("invite", { link: `${APP_URL}/invites/${invite.id}` }),
  });
  await auditLog(userId, "project.invite", { email, role });
  return data({ ok: true });
}

async function handleDelete(projectId: string, userId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.ownerId !== userId) {
    throw data("Forbidden", { status: 403 });
  }
  const usage = await prisma.usage.aggregate({ where: { projectId }, _sum: { units: true } });
  await chargeOverage(project.stripeCustomerId, usage._sum.units ?? 0);
  await prisma.project.delete({ where: { id: projectId } });
  await auditLog(userId, "project.delete", {});
  const session = await getSession();
  session.flash("toast", `Deleted ${project.name}`);
  return redirect("/projects", { headers: { "Set-Cookie": await commitSession(session) } });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  invariant(params.projectId, "projectId is required");
  const url = new URL(request.url);
  const filters = parseFilters(url);
  const project = await prisma.project.findFirst({
    where: { id: params.projectId, ...buildWhere(filters, userId) },
    include: { owner: true, tags: true },
  });
  if (!project) {
    throw data("Not found", { status: 404 });
  }
  const [activity, billing, members, invites, webhooks] = await Promise.all([
    loadActivity(project.id, filters),
    loadBilling(project.id, filters),
    loadMembers(project.id, filters),
    loadInvites(project.id, filters),
    loadWebhooks(project.id, filters),
  ]);
  return data(
    {
      project: serializeItem(project),
      filters,
      sections: { activity, billing, members, invites, webhooks },
      sentry: Boolean(SENTRY_DSN),
    },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  invariant(params.projectId, "projectId is required");
  const formData = await request.formData();
  const intent = formData.get("intent");
  try {
    switch (intent) {
      case "update":
        return await handleUpdate(params.projectId, userId, formData);
      case "invite":
        return await handleInvite(params.projectId, userId, formData);
      case "delete":
        return await handleDelete(params.projectId, userId);
      default:
        throw data(`Unknown intent ${String(intent)}`, { status: 400 });
    }
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }
}

export function headers({ loaderHeaders, parentHeaders }: Route.HeadersArgs) {
  return {
    "Cache-Control": loaderHeaders.get("Cache-Control") ?? parentHeaders.get("Cache-Control") ?? "no-store",
  };
}

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData ? `${loaderData.project.name} · Projects` : "Project not found";
  return [{ title }, { name: "description", content: "Project overview" }];
}

export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: { formMethod?: string; defaultShouldRevalidate: boolean }) {
  if (formMethod === "GET") return false;
  return defaultShouldRevalidate;
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "failed" ? "destructive" : status === "paused" ? "secondary" : "default";
  return <Badge variant={variant}>{STATUS_LABELS[status] ?? status}</Badge>;
}

function RelativeTime({ iso }: { iso: string }) {
  const date = useMemo(() => new Date(iso), [iso]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso}>{formatDistanceToNow(date, { addSuffix: true })}</time>
      </TooltipTrigger>
      <TooltipContent>{format(date, "PPpp")}</TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
      <h3 className="text-lg font-medium">{title}</h3>
      {children}
    </div>
  );
}

function FilterBar({ filters }: { filters: Filters }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(filters.q);
  const debouncedQuery = useDebounced(query);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (debouncedQuery) next.set("q", debouncedQuery);
    else next.delete("q");
    next.delete("page");
    setSearchParams(next, { replace: true });
  }, [debouncedQuery]);
  return (
    <div className="flex items-center gap-2">
      <input
        className="input"
        type="search"
        value={query}
        placeholder="Search…"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {Object.entries(STATUS_LABELS).map(([value, label]) => (
        <NavLink key={value} to={`?status=${value}`} className={({ isActive }) => cn("chip", isActive && "chip-active")}>
          {label}
        </NavLink>
      ))}
    </div>
  );
}

function ItemRow({ item, onSelect }: { item: SerializedItem; onSelect: (id: string) => void }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const { id, name, status, updatedAt, owner, tags } = item;
  return (
    <tr className={cn(busy && "opacity-50")} onClick={() => onSelect(id)}>
      <td>
        <Link to={`./${id}`} prefetch="intent">
          {name}
        </Link>
      </td>
      <td>
        <StatusBadge status={status} />
      </td>
      <td>{owner.name}</td>
      <td>{tags.join(", ")}</td>
      <td>
        <RelativeTime iso={updatedAt} />
      </td>
      <td>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="toggle" />
          <input type="hidden" name="id" value={id} />
          <Button size="sm" variant="ghost" disabled={busy}>
            {busy ? <Spinner /> : "Toggle"}
          </Button>
        </fetcher.Form>
      </td>
    </tr>
  );
}

function ActivitySection({ section, onSelect }: { section: { items: SerializedItem[]; total: number; stats: Record<string, number>; pages: number }; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const { items, total, stats, pages } = section;
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const summary = Object.entries(stats)
    .map(([status, count]) => `${STATUS_LABELS[status] ?? status}: ${count}`)
    .join(" · ");
  if (items.length === 0) {
    return <EmptyState title="No activity yet" />;
  }
  return (
    <Card>
      <CardHeader className="flex justify-between">
        <h2 className="text-base font-semibold">Activity ({total})</h2>
        <Button variant="link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {sorted.map((item) => (
                <ItemRow key={item.id} item={item} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : null}
      <CardFooter className="text-xs text-muted-foreground">
        {summary} · {pages} page(s)
      </CardFooter>
    </Card>
  );
}

function BillingSection({ section, onSelect }: { section: { items: SerializedItem[]; total: number; stats: Record<string, number>; pages: number }; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { items, total, stats, pages } = section;
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const summary = Object.entries(stats)
    .map(([status, count]) => `${STATUS_LABELS[status] ?? status}: ${count}`)
    .join(" · ");
  if (items.length === 0) {
    return <EmptyState title="No billing yet" />;
  }
  return (
    <Card>
      <CardHeader className="flex justify-between">
        <h2 className="text-base font-semibold">Billing ({total})</h2>
        <Button variant="link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {sorted.map((item) => (
                <ItemRow key={item.id} item={item} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : null}
      <CardFooter className="text-xs text-muted-foreground">
        {summary} · {pages} page(s)
      </CardFooter>
    </Card>
  );
}

function MembersSection({ section, onSelect }: { section: { items: SerializedItem[]; total: number; stats: Record<string, number>; pages: number }; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const { items, total, stats, pages } = section;
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const summary = Object.entries(stats)
    .map(([status, count]) => `${STATUS_LABELS[status] ?? status}: ${count}`)
    .join(" · ");
  if (items.length === 0) {
    return <EmptyState title="No members yet" />;
  }
  return (
    <Card>
      <CardHeader className="flex justify-between">
        <h2 className="text-base font-semibold">Members ({total})</h2>
        <Button variant="link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {sorted.map((item) => (
                <ItemRow key={item.id} item={item} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : null}
      <CardFooter className="text-xs text-muted-foreground">
        {summary} · {pages} page(s)
      </CardFooter>
    </Card>
  );
}

function InvitesSection({ section, onSelect }: { section: { items: SerializedItem[]; total: number; stats: Record<string, number>; pages: number }; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { items, total, stats, pages } = section;
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const summary = Object.entries(stats)
    .map(([status, count]) => `${STATUS_LABELS[status] ?? status}: ${count}`)
    .join(" · ");
  if (items.length === 0) {
    return <EmptyState title="No invites yet" />;
  }
  return (
    <Card>
      <CardHeader className="flex justify-between">
        <h2 className="text-base font-semibold">Invites ({total})</h2>
        <Button variant="link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {sorted.map((item) => (
                <ItemRow key={item.id} item={item} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : null}
      <CardFooter className="text-xs text-muted-foreground">
        {summary} · {pages} page(s)
      </CardFooter>
    </Card>
  );
}

function WebhooksSection({ section, onSelect }: { section: { items: SerializedItem[]; total: number; stats: Record<string, number>; pages: number }; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const { items, total, stats, pages } = section;
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const summary = Object.entries(stats)
    .map(([status, count]) => `${STATUS_LABELS[status] ?? status}: ${count}`)
    .join(" · ");
  if (items.length === 0) {
    return <EmptyState title="No webhooks yet" />;
  }
  return (
    <Card>
      <CardHeader className="flex justify-between">
        <h2 className="text-base font-semibold">Webhooks ({total})</h2>
        <Button variant="link" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {sorted.map((item) => (
                <ItemRow key={item.id} item={item} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </CardContent>
      ) : null}
      <CardFooter className="text-xs text-muted-foreground">
        {summary} · {pages} page(s)
      </CardFooter>
    </Card>
  );
}

function useSectionPreference0(key: string) {
  const storageKey = `pref:projects.$projectId:0:${key}`;
  const [value, setValue] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem(storageKey),
  );
  const update = useCallback(
    (next: string | null) => {
      setValue(next);
      if (next === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, next);
    },
    [storageKey],
  );
  return [value, update] as const;
}

export function Panel0({ title, items }: { title: string; items: SerializedItem[] }) {
  const [pinned, setPinned] = useSectionPreference0("pinned");
  const visible = items.filter(({ id }) => !pinned || id === pinned);
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {visible.map(({ id, name, status }) => (
          <li key={id} onDoubleClick={() => setPinned(pinned === id ? null : id)}>
            {name} <StatusBadge status={status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
function useSectionPreference1(key: string) {
  const storageKey = `pref:projects.$projectId:1:${key}`;
  const [value, setValue] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem(storageKey),
  );
  const update = useCallback(
    (next: string | null) => {
      setValue(next);
      if (next === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, next);
    },
    [storageKey],
  );
  return [value, update] as const;
}

export function Panel1({ title, items }: { title: string; items: SerializedItem[] }) {
  const [pinned, setPinned] = useSectionPreference1("pinned");
  const visible = items.filter(({ id }) => !pinned || id === pinned);
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {visible.map(({ id, name, status }) => (
          <li key={id} onDoubleClick={() => setPinned(pinned === id ? null : id)}>
            {name} <StatusBadge status={status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ProjectRoute() {
  const { project, filters, sections } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selected, setSelected] = useState<string | null>(null);
  const submitting = navigation.state === "submitting";
  const errors = actionData && "errors" in actionData ? actionData.errors : null;
  const onSelect = useCallback((id: string) => setSelected((current) => (current === id ? null : id)), []);
  return (
    <main className="container space-y-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            Owned by {project.owner.name} · updated <RelativeTime iso={project.updatedAt} />
          </p>
        </div>
        <StatusBadge status={project.status} />
      </header>
      <FilterBar filters={filters} />
      <Form method="post" className="grid gap-2">
        <input type="hidden" name="intent" value="update" />
        <input name="name" defaultValue={project.name} aria-invalid={Boolean(errors?.name)} />
        {errors?.name ? <p className="text-destructive">{errors.name[0]}</p> : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </Form>
      <ActivitySection section={sections.activity} onSelect={onSelect} />
      <BillingSection section={sections.billing} onSelect={onSelect} />
      <MembersSection section={sections.members} onSelect={onSelect} />
      <InvitesSection section={sections.invites} onSelect={onSelect} />
      <WebhooksSection section={sections.webhooks} onSelect={onSelect} />
      {selected ? <p className="text-xs">Selected: {selected}</p> : null}
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <EmptyState title={`${error.status} ${error.statusText}`}>
        <p>{typeof error.data === "string" ? error.data : "Something went wrong."}</p>
      </EmptyState>
    );
  }
  return <EmptyState title="Unexpected error" />;
}
