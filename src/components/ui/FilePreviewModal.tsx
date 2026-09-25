'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, FileText, X } from 'lucide-react';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const PDF_EXT = /\.pdf(\?.*)?$/i;

interface FilePreviewModalProps {
  /** File to show; null/empty keeps the modal closed. */
  url: string | null;
  onClose: () => void;
  title?: string;
}

// A download keeps the name the file was uploaded with: /api/upload stores files as
// <company>/<uuid>/<original name>, so the URL's last segment is that name. Files uploaded before
// that were stored under a bare random name (e.g. 3f2a…c91.pdf) with the original lost — those
// fall back to what the popup shows ("Aadhaar · 812345678901" -> "Aadhaar - 812345678901.pdf").
const RANDOM_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[A-Za-z0-9]+)?$/i;

function downloadNameFor(title: string, url: string): string {
  const last = url.split('?')[0].split('/').pop() ?? '';
  let original = last;
  try { original = decodeURIComponent(last); } catch { /* keep as-is */ }
  if (original && !RANDOM_NAME.test(original)) return original;

  const ext = (url.split('?')[0].match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '').toLowerCase();
  const base = title.replace(/\s*·\s*/g, ' - ').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'document';
  return `${base}${ext}`;
}

// Fetches the file and saves it under `name`. The <a download> attribute alone is ignored for
// cross-origin URLs (files in object storage), so it would fall back to the random stored name.
async function saveAs(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const objectUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Shows an uploaded file (image or PDF) in a popup on the current page instead of a new tab. */
export function FilePreviewModal({ url, onClose, title = 'Document' }: FilePreviewModalProps) {
  useEffect(() => {
    if (!url) return;
    // Capture phase on window runs before the document-level Escape handler of any host Modal
    // this preview is opened from, so Escape closes only the preview, not the form behind it.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [url, onClose]);

  if (!url || typeof document === 'undefined') return null;

  const fileName = downloadNameFor(title, url);
  const isImage = IMAGE_EXT.test(url);
  const isPdf = PDF_EXT.test(url);

  // Portalled to <body>: a host Modal's entry animation leaves a transform on its panel, which
  // would otherwise make this `fixed` overlay position (and clip) relative to that panel.
  return createPortal(
    <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative surface-card rounded-2xl w-full max-w-4xl h-[85vh] max-h-full flex flex-col overflow-hidden animate-modal-in"
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <FileText className="w-4 h-4 text-[color:var(--color-primary)] flex-shrink-0" />
          <p className="text-sm font-semibold text-[#0F172A] truncate flex-1">{title}</p>
          <a
            href={url}
            download={fileName}
            onClick={(e) => { e.preventDefault(); saveAs(url, fileName); }}
            className="p-2 rounded-lg text-slate-500 hover:text-[color:var(--color-primary)] hover:bg-slate-50 transition-colors duration-150"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-slate-50 flex items-center justify-center">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-uploaded file URL
            <img src={url} alt={title} className="max-w-full max-h-full object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={title} className="w-full h-full border-0 bg-white" />
          ) : (
            <div className="text-center px-6">
              <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-600 mb-1">This file type can&apos;t be previewed here.</p>
              <p className="text-xs text-slate-400 mb-4 break-all">{fileName}</p>
              <div className="flex items-center justify-center gap-2">
                <a
                  href={url}
                  download={fileName}
                  onClick={(e) => { e.preventDefault(); saveAs(url, fileName); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[color:var(--color-primary)] hover:opacity-90 text-white rounded-lg transition-opacity duration-150"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors duration-150"
                >
                  <ExternalLink className="w-4 h-4" /> Open in new tab
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
