'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Printer, Save, Trash2, FileText } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { formatDate } from '@/lib/utils';
import { PLACEHOLDER_REFERENCE } from '@/lib/documentMerge';

interface TemplateOption { template_pkey: number; template_name: string; availability: string }
interface TemplateDetail { template_pkey: number; template_name: string; template_content: string; availability: string }
interface HistoryRow { document_pkey: number; document_name: string; doc_id: string; creation_date: string; first_name: string; last_name: string | null }

const TABS = [
  { key: 'generate', label: 'Generate' },
  { key: 'templates', label: 'Templates' },
  { key: 'history', label: 'History' },
] as const;
type TabKey = typeof TABS[number]['key'];

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
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
          <EmployeeSearch value={empId} onChange={setEmpId} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Select template</option>
            {templates.map((t) => <option key={t.template_pkey} value={t.template_pkey}>{t.template_name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex gap-2">
          <button
            onClick={() => generate.mutate(false)}
            disabled={!empId || !templateId || generate.isPending}
            className="px-4 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Preview
          </button>
        </div>
        {generate.isError && <p className="text-red-500 text-sm sm:col-span-2">{String(generate.error)}</p>}
      </div>

      {preview && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Preview</h2>
            <div className="flex gap-2">
              {!preview.saved && (
                <button
                  onClick={() => generate.mutate(true)}
                  disabled={generate.isPending}
                  className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
              )}
              <button
                onClick={() => printHtml(preview.html, templateName)}
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
              </button>
            </div>
          </div>
          {preview.saved && <p className="text-xs text-emerald-600 mb-2">Saved to document history.</p>}
          <div className="border border-gray-100 rounded-lg p-6 max-h-[32rem] overflow-y-auto prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
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
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {templates.map((t) => (
          <div key={t.template_pkey} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-900">{t.template_name}</span>
              {t.availability !== '1' && <span className="text-xs text-gray-400">(inactive)</span>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => openEdit(t.template_pkey)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
              <button
                onClick={() => { if (confirm('Delete this template?')) remove.mutate(t.template_pkey); }}
                className="text-gray-400 hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {templates.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No templates yet.</p>}
      </div>

      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditingId(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editingId === 'new' ? 'New Template' : 'Edit Template'}</h2>
              <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                <input
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.template_name}
                  onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value }))}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Content (HTML, use {'{:placeholder}'} tokens)</label>
                  <button type="button" onClick={() => setShowReference((s) => !s)} className="text-xs text-indigo-600 hover:text-indigo-800">
                    {showReference ? 'Hide' : 'Show'} placeholder reference
                  </button>
                </div>
                {showReference && (
                  <div className="mb-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-1.5 max-h-40 overflow-y-auto">
                    {PLACEHOLDER_REFERENCE.map((g) => (
                      <div key={g.group}>
                        <span className="font-medium text-gray-700">{g.group}: </span>
                        {g.tokens.map((t) => `{:${t}}`).join(', ')}
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  required
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.template_content}
                  onChange={(e) => setForm((f) => ({ ...f, template_content: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.availability === '1'}
                  onChange={(e) => setForm((f) => ({ ...f, availability: e.target.checked ? '1' : '0' }))}
                />
                Available for generating documents
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditingId(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
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
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {data.map((row) => (
        <div key={row.document_pkey} className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm text-gray-900">{row.document_name}</p>
            <p className="text-xs text-gray-400">{row.first_name} {row.last_name ?? ''} · {formatDate(row.creation_date)}</p>
          </div>
          <button onClick={() => view(row.document_pkey)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            View
          </button>
        </div>
      ))}
      {data.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No documents generated yet.</p>}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setViewing(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{viewing.document_name}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => printHtml(viewing.document, viewing.document_name)} className="text-gray-400 hover:text-gray-700">
                  <Printer className="w-5 h-5" />
                </button>
                <button onClick={() => setViewing(null)} className="p-1 rounded hover:bg-gray-100">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>
            <div className="border border-gray-100 rounded-lg p-6 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: viewing.document }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function GenerateDocumentsPage() {
  const [tab, setTab] = useState<TabKey>('generate');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Generate Employee Documents</h1>

      <div className="flex items-center gap-1 text-sm mb-5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              tab === t.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'generate' && <GenerateTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
