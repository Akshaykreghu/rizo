import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';

// Serves files saved by /api/upload's local-disk fallback (public/uploads/<company>/...).
//
// In production (`next build` + `next start`, as on the dev server) Next only serves the files
// that were already in public/ at BUILD time — anything uploaded afterwards 404s, so a freshly
// uploaded profile photo or document showed as a broken image until the next deploy rebuilt the
// app. Files that did exist at build time are still served statically by Next before this route
// is reached; this only fills in the rest, at the same /uploads/... URLs, so no stored path changes.
// Access is behind login like every other page (src/proxy.ts), same as before.

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const parts = segments.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const filePath = path.resolve(UPLOAD_ROOT, ...parts);
  // Never serve anything outside public/uploads (e.g. "../" tricks).
  if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new NextResponse('Not found', { status: 404 });
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return new NextResponse(body, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(info.size),
        // Stored names never change once written (each upload gets its own random folder).
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        // User-uploaded SVG can carry script — never let it run if opened directly.
        ...(type === 'image/svg+xml' ? { 'Content-Security-Policy': 'sandbox' } : {}),
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
