import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { isSpacesConfigured, uploadToSpaces } from '@/lib/storage';

// Characters that can't be in a file name on disk / in an object key: path separators, Windows-
// reserved characters, URL-special ones, and control characters.
const UNSAFE_CHARS = new RegExp('[\\\\/:*?"<>|#%&{}$!\'@+`=\\u0000-\\u001f]+', 'g');

// Keeps the uploader's own file name so a download comes back under the same name: each file
// lives in its own random folder (<company>/<uuid>/<original name>), which keeps two uploads that
// share a name apart without renaming either. Only unsafe characters are replaced (with "_"), and
// very long names are shortened (keeping the extension) so the stored URL fits the DB columns.
function safeFileName(original: string): string {
  const ext = path.extname(original).slice(0, 10);
  let base = path.basename(original, path.extname(original))
    .replace(UNSAFE_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!base) base = 'file';
  while (encodeURIComponent(base + ext).length > 120 && base.length > 1) base = base.slice(0, -1);
  return base.trim() + ext;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const folder = crypto.randomUUID();
  const name = safeFileName(file.name);
  const company = session.user.companyCode;

  if (isSpacesConfigured()) {
    // Object key holds the plain name; the returned URL percent-encodes it (spaces etc.).
    const url = await uploadToSpaces(buffer, `${company}/${folder}/${name}`, file.type || 'application/octet-stream');
    const encodedUrl = url.slice(0, url.length - name.length) + encodeURIComponent(name);
    return NextResponse.json({ path: encodedUrl }, { status: 201 });
  }

  // Local-disk fallback for development, or if Spaces isn't configured yet. The file on disk keeps
  // the plain name; the URL percent-encodes it.
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', company, folder);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, name), buffer);

  return NextResponse.json({ path: `/uploads/${company}/${folder}/${encodeURIComponent(name)}` }, { status: 201 });
}
