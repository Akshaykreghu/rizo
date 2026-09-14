'use client';

import { useState } from 'react';
import { UploadCloud, Loader2, FileCheck2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DocumentUploadFieldProps {
  value: string;
  onChange: (path: string) => void;
}

export function DocumentUploadField({ value, onChange }: DocumentUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file: File) {
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      onChange(data.path);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) uploadFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors duration-150',
          dragOver ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/5' : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
        )}
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        ) : value ? (
          <FileCheck2 className="w-5 h-5 text-[color:var(--color-success)]" />
        ) : (
          <UploadCloud className="w-5 h-5 text-slate-400" />
        )}
        <p className="text-[13px] font-medium text-slate-600">
          {uploading ? 'Uploading…' : value ? 'File uploaded — drop to replace' : 'Drag & drop your document here'}
        </p>
        {!uploading && (
          <p className="text-xs text-slate-400">
            or <span className="text-[color:var(--color-primary)] font-medium">Choose File</span>
          </p>
        )}
        <input type="file" onChange={handleFileInput} disabled={uploading} className="hidden" />
      </label>
      {value && !uploading && (
        <a href={value} target="_blank" rel="noreferrer" className="inline-block mt-1.5 text-xs text-[color:var(--color-primary)] hover:underline">
          View uploaded file
        </a>
      )}
      {error && <p className="text-xs text-[color:var(--color-danger)] mt-1.5">{error}</p>}
    </div>
  );
}
