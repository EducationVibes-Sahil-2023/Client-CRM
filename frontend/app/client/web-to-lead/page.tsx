"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Badge, ConfirmDialog, Spinner } from "../../admin/ui";
import { DataTable, IconButton, type Column } from "../../admin/DataTable";
import { useClient } from "../ClientContext";
import { useToast } from "../../components/toast/ToastProvider";
import { listWebForms, deleteWebForm, type WebForm } from "../../lib/client";

/** Public base URL the embeddable form is served from (same origin in production). */
function appBase(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
export function formUrl(token: string): string {
  return `${appBase()}/forms/wtl/${token}`;
}

export default function WebToLeadPage() {
  const { isAdmin, permissionsLoaded } = useClient();
  const toast = useToast();
  const router = useRouter();
  const [forms, setForms] = useState<WebForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [del, setDel] = useState<WebForm | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setLoading(true);
    listWebForms()
      .then((d) => setForms(d.forms))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  // Initial load — set state only inside the promise callbacks (not synchronously).
  useEffect(() => {
    let alive = true;
    listWebForms()
      .then((d) => { if (alive) setForms(d.forms); })
      .catch((e) => { if (alive) toast.error(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function copyEmbed(f: WebForm) {
    const code = `<iframe width="600" height="850" src="${formUrl(f.token)}" frameborder="0" allowfullscreen></iframe>`;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Embed code copied");
    } catch {
      toast.error("Could not copy — open the form to copy manually.");
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    try {
      await deleteWebForm(del.id);
      toast.success("Form deleted");
      setDel(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (permissionsLoaded && !isAdmin) {
    return (
      <Card className="mx-auto mt-10 max-w-lg text-center">
        <h2 className="text-lg font-semibold text-slate-800">Admins only</h2>
        <p className="mt-1 text-sm text-slate-500">Only the client admin can manage web forms.</p>
      </Card>
    );
  }

  const columns: Column<WebForm>[] = [
    {
      key: "name",
      header: "Form",
      lockVisible: true,
      render: (f) => (
        <button onClick={() => router.push(`/client/web-to-lead/${f.id}`)} className="text-left font-medium text-emerald-700 hover:underline">
          {f.name}
        </button>
      ),
    },
    { key: "fields", header: "Fields", align: "center", render: (f) => <span className="tabular-nums text-slate-600">{f.fields.length}</span> },
    { key: "submission_count", header: "Submissions", align: "center", render: (f) => <span className="font-semibold tabular-nums text-slate-800">{f.submission_count}</span> },
    { key: "enabled", header: "Status", align: "center", render: (f) => <Badge value={f.enabled ? "active" : "inactive"} /> },
    {
      key: "token",
      header: "Public link",
      render: (f) => (
        <a href={formUrl(f.token)} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-emerald-600 hover:underline">
          /forms/wtl/{f.token.slice(0, 8)}…
        </a>
      ),
    },
  ];

  const quickActions = (f: WebForm) => (
    <div className="flex items-center gap-1.5">
      <IconButton title="Open form" onClick={() => window.open(formUrl(f.token), "_blank")}><EyeIcon /></IconButton>
      <IconButton title="Edit" onClick={() => router.push(`/client/web-to-lead/${f.id}`)}><PencilIcon /></IconButton>
      <IconButton title="Copy embed code" onClick={() => copyEmbed(f)}><CodeIcon /></IconButton>
      <IconButton title="Delete" danger onClick={() => setDel(f)}><TrashIcon /></IconButton>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Web to Lead"
        subtitle="Build embeddable forms that capture leads straight into your CRM."
        action={
          <Link href="/client/web-to-lead/new" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
            + New Form
          </Link>
        }
      />

      {loading && forms.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <DataTable
          columns={columns}
          rows={forms}
          getKey={(f) => f.id}
          loading={loading}
          emptyTitle="No web forms yet"
          emptyHint="Create your first form and embed it on your website to start capturing leads."
          quickActions={quickActions}
          paginate
        />
      )}

      <ConfirmDialog
        open={!!del}
        title="Delete this form?"
        message={<>The form <b>{del?.name}</b> will be removed and its public link will stop accepting submissions. Existing leads are kept. This can be restored by support if needed.</>}
        confirmLabel="Delete form"
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setDel(null)}
      />
    </div>
  );
}

function EyeIcon() {
  return <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function PencilIcon() {
  return <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" /></svg>;
}
function CodeIcon() {
  return <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>;
}
function TrashIcon() {
  return <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6" /></svg>;
}
