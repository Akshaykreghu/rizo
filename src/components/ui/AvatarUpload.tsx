'use client';

import { useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';

interface AvatarUploadProps {
  name: string;
  imageUrl?: string | null;
  /** Called with the uploaded file's storage path once the upload completes. */
  onUploaded: (path: string) => void;
  /** Sizes the clickable area (and the avatar within it), e.g. "w-11 h-11". */
  className?: string;
  /** Forwarded to the inner Avatar (e.g. to match its initials text size). */
  avatarClassName?: string;
  /** When true, renders a plain read-only avatar with no upload affordance. */
  disabled?: boolean;
}

export function AvatarUpload({ name, imageUrl, onUploaded, className, avatarClassName, disabled }: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      onUploaded(data.path);
    } finally {
      setUploading(false);
    }
  }

  if (disabled) {
    return <Avatar name={name} imageUrl={imageUrl} className={cn(className, avatarClassName)} />;
  }

  return (
    <label
      className={cn('relative group/avatar block flex-shrink-0 rounded-full cursor-pointer', className)}
      title="Change photo"
    >
      <Avatar name={name} imageUrl={imageUrl} className={cn('w-full h-full', avatarClassName)} />
      <span className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover/avatar:bg-black/40 transition-colors duration-[180ms]">
        {uploading ? (
          <Loader2 className="w-4 h-4 text-white animate-spin" />
        ) : (
          <Camera className="w-4 h-4 text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-[180ms]" />
        )}
      </span>
      <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} className="hidden" />
    </label>
  );
}
