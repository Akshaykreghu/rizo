'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Printer, Save, Trash2, FileText, Image as ImageIcon, Download, Mail } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatDate } from '@/lib/utils';
import { PLACEHOLDER_REFERENCE } from '@/lib/documentMerge';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/imageTemplate';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface TemplateOption { template_pkey: number; template_name: string; availability: string }
interface TemplateDetail { template_pkey: number; template_name: string; template_content: string; availability: string }
interface HistoryRow { document_pkey: number; document_name: string; doc_id: string; creation_date: string; first_name: string; last_name: string | null }

const TABS = [
  { key: 'generate', label: 'Generate' },
  { key: 'templates', label: 'Templates' },
  { key: 'image', label: 'Image Templates' },
  { key: 'history', label: 'History' },
] as const;
type TabKey = typeof TABS[number]['key'];

interface ImageTemplateRow {
  id: number;
  name: string | null;
  type: string | null;
  image: string | null;
  imageLeft: number; imageTop: number; imagesize: number; imageHeight: number;
  is_default: number;
  text_content: string | null;
  left_axis: number; top_axis: number;
}

function printHtml(html: string, title: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<html><head><title>${title}</title></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function GenerateTab() {
  const [empId, setEmpId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState<{ html: string; saved: boolean } | null>(null);

  const { data: templates = [] } = useQuery<TemplateOption[]>({
    queryKey: ['document-templates', 'active'],
    queryFn: () => fetch('/api/document-templates?active=1').then((r) => r.json()),
  });

  const generate = useMutation({
    mutationFn: (save: boolean) =>
      fetch(`/api/employees/${empId}/generate-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_fkey: Number(templateId), save }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to generate');
        return res.json();
      }),
    onSuccess: (data, save) => setPreview({ html: data.html, saved: save }),
  });

  const templateName = templates.find((t) => String(t.template_pkey) === templateId)?.template_name ?? 'Document';

  return (
    <div className="space-y-4">
      <div className="surface-card rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={empId} onChange={setEmpId} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Template</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className={cn(INPUT_CLASS, 'w-full')}
          >
            <option value="">Select template</option>
            {templates.map((t) => <option key={t.template_pkey} value={t.template_pkey}>{t.template_name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex gap-2">
          <button
            onClick={() => generate.mutate(false)}
            disabled={!empId || !templateId || generate.isPending}
            className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            Preview
          </button>
        </div>
        {generate.isError && <p className="text-[12.5px] text-[color:var(--color-danger)] sm:col-span-2">{String(generate.error)}</p>}
      </div>

      {preview && (
        <div className="surface-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide">Preview</h2>
            <div className="flex gap-2">
              {!preview.saved && (
                <button
                  onClick={() => generate.mutate(true)}
                  disabled={generate.isPending}
                  className={cn(BTN_BASE, 'bg-[color:var(--color-success-soft)] hover:opacity-80 text-[color:var(--color-success-dark)] shadow-none')}
                >
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
              )}
              <button
                onClick={() => printHtml(preview.html, templateName)}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary-light)] hover:opacity-80 text-[color:var(--color-primary-dark)] shadow-none')}
              >
                <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
              </button>
            </div>
          </div>
          {preview.saved && <p className="text-[11.5px] text-[color:var(--color-success-dark)] mb-2">Saved to document history.</p>}
          <div className="border border-slate-100 rounded-lg p-6 max-h-[32rem] overflow-y-auto prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null | 'new'>(null);
  const [form, setForm] = useState({ template_name: '', template_content: '', availability: '1' });
  const [showReference, setShowReference] = useState(false);

  const { data: templates = [] } = useQuery<TemplateOption[]>({
    queryKey: ['document-templates', 'all'],
    queryFn: () => fetch('/api/document-templates').then((r) => r.json()),
  });

  const { data: detail } = useQuery<TemplateDetail>({
    queryKey: ['document-templates', editingId],
    queryFn: () => fetch(`/api/document-templates/${editingId}`).then((r) => r.json()),
    enabled: typeof editingId === 'number',
  });

  function openNew() {
    setForm({ template_name: '', template_content: '', availability: '1' });
    setEditingId('new');
  }
  function openEdit(id: number) {
    setEditingId(id);
  }
  useEffect(() => {
    if (detail && editingId === detail.template_pkey) {
      setForm({ template_name: detail.template_name, template_content: detail.template_content, availability: detail.availability });
    }
  }, [detail, editingId]);

  const save = useMutation({
    mutationFn: () => {
      const isNew = editingId === 'new';
      return fetch(isNew ? '/api/document-templates' : `/api/document-templates/${editingId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-templates'] });
      setEditingId(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/document-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['document-templates'] }),
  });

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={openNew}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New Template
        </button>
      </div>

      <div className="surface-card rounded-xl divide-y divide-slate-100">
        {templates.map((t) => (
          <div key={t.template_pkey} className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[13px] text-[#0F172A]">{t.template_name}</span>
              {t.availability !== '1' && <span className="text-[11px] text-slate-400">(inactive)</span>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => openEdit(t.template_pkey)} className="text-[11.5px] text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] font-medium">Edit</button>
              <button
                onClick={() => { if (confirm('Delete this template?')) remove.mutate(t.template_pkey); }}
                className="p-1 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {templates.length === 0 && <p className="px-4 py-6 text-[12.5px] text-slate-400">No templates yet.</p>}
      </div>

      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setEditingId(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-modal-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{editingId === 'new' ? 'New Template' : 'Edit Template'}</h2>
              <button onClick={() => setEditingId(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Template Name</label>
                <input
                  required
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={form.template_name}
                  onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value }))}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[12px] font-medium text-slate-600">Content (HTML, use {'{:placeholder}'} tokens)</label>
                  <button type="button" onClick={() => setShowReference((s) => !s)} className="text-[11.5px] text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)]">
                    {showReference ? 'Hide' : 'Show'} placeholder reference
                  </button>
                </div>
                {showReference && (
                  <div className="mb-2 p-3 bg-slate-50 rounded-lg text-[11.5px] text-slate-600 space-y-1.5 max-h-40 overflow-y-auto">
                    {PLACEHOLDER_REFERENCE.map((g) => (
                      <div key={g.group}>
                        <span className="font-medium text-slate-700">{g.group}: </span>
                        {g.tokens.map((t) => `{:${t}}`).join(', ')}
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  required
                  rows={12}
                  className={cn(INPUT_CLASS, 'w-full font-mono')}
                  value={form.template_content}
                  onChange={(e) => setForm((f) => ({ ...f, template_content: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-slate-700">
                <input
                  type="checkbox"
                  checked={form.availability === '1'}
                  onChange={(e) => setForm((f) => ({ ...f, availability: e.target.checked ? '1' : '0' }))}
                  className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                />
                Available for generating documents
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingId(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    save.isPending
                      ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                      : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
                  )}
                >
                  {save.isPending ? 'Saving…' : 'Save Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const [viewing, setViewing] = useState<{ document_name: string; document: string } | null>(null);

  const { data = [] } = useQuery<HistoryRow[]>({
    queryKey: ['documents'],
    queryFn: () => fetch('/api/documents').then((r) => r.json()),
  });

  async function view(id: number) {
    const res = await fetch(`/api/documents/${id}`);
    setViewing(await res.json());
  }

  return (
    <div className="surface-card rounded-xl divide-y divide-slate-100">
      {data.map((row) => (
        <div key={row.document_pkey} className="flex items-center justify-between px-4 py-2.5">
          <div>
            <p className="text-[13px] text-[#0F172A]">{row.document_name}</p>
            <p className="text-[11.5px] text-slate-400">{row.first_name} {row.last_name ?? ''} · {formatDate(row.creation_date)}</p>
          </div>
          <button onClick={() => view(row.document_pkey)} className="text-[11.5px] text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] font-medium">
            View
          </button>
        </div>
      ))}
      {data.length === 0 && <p className="px-4 py-6 text-[12.5px] text-slate-400">No documents generated yet.</p>}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setViewing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-modal-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{viewing.document_name}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => printHtml(viewing.document, viewing.document_name)} className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150">
                  <Printer className="w-4 h-4" />
                </button>
                <button onClick={() => setViewing(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>
            <div className="border border-slate-100 rounded-lg p-6 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: viewing.document }} />
          </div>
        </div>
      )}
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Client-side equivalent of legacy renderImageTempalte(): background + photo box + text, drawn to
// a canvas at the same 899x880 the legacy microservice used, exported as PNG.
async function renderToPng(row: ImageTemplateRow, text: string, photoUrl: string): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const bg = await loadImage(row.image ?? '');
  if (bg) ctx.drawImage(bg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (photoUrl) {
    const photo = await loadImage(photoUrl);
    if (photo) ctx.drawImage(photo, row.imageLeft, row.imageTop, row.imagesize || 120, row.imageHeight || 120);
  }

  const plain = text.replace(/<[^>]+>/g, '').trim();
  if (plain) {
    ctx.fillStyle = '#111111';
    ctx.font = '28px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText(plain, row.left_axis, Number(row.top_axis) + 60);
  }
  return canvas.toDataURL('image/png');
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ImageTemplatesTab() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<'all' | 'certificate' | 'birthday'>('all');
  const [editing, setEditing] = useState<ImageTemplateRow | 'new' | null>(null);

  const { data: rows, isError, error } = useQuery<ImageTemplateRow[]>({
    queryKey: ['image-templates', typeFilter],
    queryFn: async () => {
      const res = await fetch(`/api/document-templates/image${typeFilter === 'all' ? '' : `?type=${typeFilter}`}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      return res.json();
    },
  });

  const unavailable = isError && String(error).includes('image_templates_unavailable');

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/document-templates/image/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['image-templates'] }),
  });
  const setDefault = useMutation({
    mutationFn: (id: number) => fetch(`/api/document-templates/image/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setDefault: true }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['image-templates'] }),
  });

  if (unavailable) {
    return (
      <div className="surface-card rounded-2xl p-6 text-[13px] text-slate-500">
        The image-template tables don&apos;t exist in this tenant&apos;s database yet. Run{' '}
        <code className="text-[12px] bg-slate-100 px-1 py-0.5 rounded">node scripts/create-image-templates.mjs {'<companyCode>'}</code>{' '}
        once to create them, then reload.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {(['all', 'certificate', 'birthday'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn('px-3 py-1 rounded-md font-medium border capitalize', typeFilter === t
                ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                : 'bg-white text-slate-500 border-transparent hover:bg-white/70')}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={() => setEditing('new')} className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
          <Plus className="w-3.5 h-3.5" /> New Image Template
        </button>
      </div>

      <div className="surface-card rounded-xl divide-y divide-slate-100">
        {(rows ?? []).map((row) => (
          <div key={row.id} className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[13px] text-[#0F172A] truncate">{row.name || 'Untitled'}</span>
              <span className="text-[11px] text-slate-400 capitalize">({row.type || 'certificate'})</span>
              {row.is_default === 1 && <span className="text-[10.5px] font-medium text-[color:var(--color-success-dark)] bg-[color:var(--color-success-soft)] px-1.5 py-0.5 rounded">default</span>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {row.type === 'birthday' && row.is_default !== 1 && (
                <button onClick={() => setDefault.mutate(row.id)} className="text-[11.5px] text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] font-medium">Set default</button>
              )}
              <button onClick={() => setEditing(row)} className="text-[11.5px] text-[color:var(--color-primary)] hover:text-[color:var(--color-primary-dark)] font-medium">Edit</button>
              <button
                onClick={() => { if (confirm('Delete this image template?')) remove.mutate(row.id); }}
                className="p-1 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {rows && rows.length === 0 && <p className="px-4 py-6 text-[12.5px] text-slate-400">No image templates yet.</p>}
      </div>

      <ImageTemplateGenerate templates={rows ?? []} />

      {editing !== null && (
        <ImageTemplateEditor
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ['image-templates'] }); }}
        />
      )}
    </div>
  );
}

function ImageTemplateGenerate({ templates }: { templates: ImageTemplateRow[] }) {
  const [empId, setEmpId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [result, setResult] = useState<{ html: string; row: ImageTemplateRow; resolvedText: string; photoUrl: string } | null>(null);
  const [sendMsg, setSendMsg] = useState('');

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/${empId}/generate-image-document`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: Number(templateId) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to generate');
      return res.json();
    },
    onSuccess: (data) => {
      const row = templates.find((t) => t.id === Number(templateId));
      if (row) setResult({ html: data.html, row, resolvedText: data.resolvedText, photoUrl: data.photoUrl });
    },
  });

  const sendBirthday = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/employees/${empId}/birthday-wish`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to send');
      return res.json();
    },
    onSuccess: (data: { status: string; to?: string }) => {
      setSendMsg(
        data.status === 'sent' ? `Sent to ${data.to}.`
        : data.status === 'skipped-no-smtp' ? 'SMTP is not configured — nothing was sent (set SMTP_* env vars to enable).'
        : data.status === 'no-default-template' ? 'No default birthday template set.'
        : data.status === 'no-email' ? 'This employee has no email address on file.'
        : `Result: ${data.status}`
      );
    },
  });

  const selected = templates.find((t) => t.id === Number(templateId));

  async function download() {
    if (!result) return;
    const png = await renderToPng(result.row, result.resolvedText, result.photoUrl);
    downloadDataUrl(png, `${result.row.name || 'certificate'}.png`);
  }
  async function addToPdf() {
    if (!result) return;
    const png = await renderToPng(result.row, result.resolvedText, result.photoUrl);
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: CANVAS_WIDTH > CANVAS_HEIGHT ? 'landscape' : 'portrait', unit: 'px', format: [CANVAS_WIDTH, CANVAS_HEIGHT] });
    pdf.addImage(png, 'PNG', 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    pdf.save(`${result.row.name || 'certificate'}.pdf`);
  }

  return (
    <div className="surface-card rounded-xl p-4 space-y-3">
      <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide">Generate for Employee</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={empId} onChange={setEmpId} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Template</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={cn(INPUT_CLASS, 'w-full')}>
            <option value="">Select template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name || 'Untitled'} ({t.type || 'certificate'})</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => generate.mutate()}
          disabled={!empId || !templateId || generate.isPending}
          className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
        >
          Preview
        </button>
        {result && (
          <>
            <button onClick={download} className={cn(BTN_BASE, 'bg-[color:var(--color-primary-light)] hover:opacity-80 text-[color:var(--color-primary-dark)] shadow-none')}>
              <Download className="w-3.5 h-3.5" /> Download PNG
            </button>
            <button onClick={addToPdf} className={cn(BTN_BASE, 'bg-[color:var(--color-primary-light)] hover:opacity-80 text-[color:var(--color-primary-dark)] shadow-none')}>
              <Printer className="w-3.5 h-3.5" /> Add to PDF
            </button>
          </>
        )}
        {selected?.type === 'birthday' && empId && (
          <button
            onClick={() => { setSendMsg(''); sendBirthday.mutate(); }}
            disabled={sendBirthday.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-success-soft)] hover:opacity-80 text-[color:var(--color-success-dark)] shadow-none')}
          >
            <Mail className="w-3.5 h-3.5" /> {sendBirthday.isPending ? 'Sending…' : 'Send birthday wish'}
          </button>
        )}
      </div>
      {generate.isError && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String(generate.error)}</p>}
      {sendMsg && <p className="text-[12.5px] text-slate-600">{sendMsg}</p>}
      {result && (
        <div className="border border-slate-100 rounded-lg overflow-auto max-h-[32rem]">
          <div style={{ width: CANVAS_WIDTH, transform: 'scale(0.6)', transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: result.html }} />
        </div>
      )}
    </div>
  );
}

function ImageTemplateEditor({ row, onClose, onSaved }: { row: ImageTemplateRow | null; onClose: () => void; onSaved: () => void }) {
  const PREVIEW_W = 540;
  const scale = PREVIEW_W / CANVAS_WIDTH;
  const [form, setForm] = useState({
    name: row?.name ?? '', type: row?.type ?? 'certificate', image: row?.image ?? '',
    text_content: row?.text_content ?? 'Congratulations {{first_name}} {{last_name}}',
    left_axis: Number(row?.left_axis ?? 120), top_axis: Number(row?.top_axis ?? 300),
    imageLeft: Number(row?.imageLeft ?? 360), imageTop: Number(row?.imageTop ?? 120),
    imagesize: Number(row?.imagesize ?? 160), imageHeight: Number(row?.imageHeight ?? 160),
  });
  const [uploading, setUploading] = useState(false);
  const drag = useRef<{ target: 'text' | 'photo'; startX: number; startY: number; origX: number; origY: number } | null>(null);

  function onPointerDown(target: 'text' | 'photo', e: React.PointerEvent) {
    e.preventDefault();
    drag.current = {
      target,
      startX: e.clientX, startY: e.clientY,
      origX: target === 'text' ? form.left_axis : form.imageLeft,
      origY: target === 'text' ? form.top_axis : form.imageTop,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.startX) / scale;
    const dy = (e.clientY - drag.current.startY) / scale;
    const nx = Math.round(drag.current.origX + dx);
    const ny = Math.round(drag.current.origY + dy);
    setForm((f) => drag.current!.target === 'text'
      ? { ...f, left_axis: nx, top_axis: ny }
      : { ...f, imageLeft: nx, imageTop: ny });
  }
  function onPointerUp() { drag.current = null; }

  async function uploadBackground(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) setForm((f) => ({ ...f, image: data.path }));
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => fetch(row ? `/api/document-templates/image/${row.id}` : '/api/document-templates/image', {
      method: row ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(async (res) => { if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save'); }),
    onSuccess: onSaved,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto animate-modal-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{row ? 'Edit Image Template' : 'New Image Template'}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"><X className="w-4.5 h-4.5" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Name</label>
              <input required className={cn(INPUT_CLASS, 'w-full')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Type</label>
              <select className={cn(INPUT_CLASS, 'w-full')} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="certificate">certificate</option>
                <option value="birthday">birthday</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Background image</label>
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBackground(f); e.target.value = ''; }} className="text-[11.5px]" />
              {uploading && <span className="text-[11px] text-slate-400 ml-1">uploading…</span>}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Text ({'{{first_name}}'}, {'{{last_name}}'}, {'{{empolyee_name}}'}, {'{{employee_designation}}'}, {'{{current_date}}'}…)</label>
            <textarea rows={2} className={cn(INPUT_CLASS, 'w-full')} value={form.text_content} onChange={(e) => setForm((f) => ({ ...f, text_content: e.target.value }))} />
          </div>

          <div>
            <p className="text-[11.5px] text-slate-500 mb-1">Drag the text and photo boxes to position them.</p>
            <div
              className="relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50 select-none"
              style={{ width: PREVIEW_W, height: CANVAS_HEIGHT * scale }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {form.image
                ? <img src={form.image} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                : <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">Upload a background image</div>}

              <div
                onPointerDown={(e) => onPointerDown('photo', e)}
                className="absolute border-2 border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10 cursor-move flex items-center justify-center text-[10px] text-[color:var(--color-primary-dark)]"
                style={{ left: form.imageLeft * scale, top: form.imageTop * scale, width: form.imagesize * scale, height: form.imageHeight * scale }}
              >
                photo
              </div>
              <div
                onPointerDown={(e) => onPointerDown('text', e)}
                className="absolute px-1 bg-[color:var(--color-highlight-light)] border border-[color:var(--color-highlight-dark)] cursor-move text-[11px] text-[color:var(--color-highlight-dark)] whitespace-nowrap"
                style={{ left: form.left_axis * scale, top: (Number(form.top_axis) + 60) * scale }}
              >
                {form.text_content.replace(/<[^>]+>/g, '').slice(0, 40) || 'text'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['imagesize', 'imageHeight'] as const).map((k) => (
              <div key={k}>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">{k === 'imagesize' ? 'Photo width' : 'Photo height'}</label>
                <input type="number" className={cn(INPUT_CLASS, 'w-full')} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }))} />
              </div>
            ))}
          </div>

          {save.isError && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String(save.error)}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
            <button type="submit" disabled={save.isPending} className={cn('px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm', save.isPending ? 'bg-[color:var(--color-primary)]/60' : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]')}>
              {save.isPending ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GenerateDocumentsPage() {
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<TabKey>('generate');

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Generate Employee Documents
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Generate, template, and review employee documents
            </p>
          </div>,
          slotEl
        )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-5">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.key
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'generate' && <GenerateTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'image' && <ImageTemplatesTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
