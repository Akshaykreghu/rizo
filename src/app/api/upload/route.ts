import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { isSpacesConfigured, uploadToSpaces } from '@/lib/storage';

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
  const ext = path.extname(file.name) || '';
  const filename = `${crypto.randomUUID()}${ext}`;

  if (isSpacesConfigured()) {
    const key = `${session.user.companyCode}/${filename}`;
    const url = await uploadToSpaces(buffer, key, file.type || 'application/octet-stream');
    return NextResponse.json({ path: url }, { status: 201 });
  }

  // Local-disk fallback for development, or if Spaces isn't configured yet.
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', session.user.companyCode);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), buffer);

  return NextResponse.json({ path: `/uploads/${session.user.companyCode}/${filename}` }, { status: 201 });
}
