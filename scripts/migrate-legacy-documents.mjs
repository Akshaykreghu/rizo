#!/usr/bin/env node
// One-off admin utility: fixes up document_upload.document_path rows that were migrated
// from the legacy CakePHP app and still store an absolute *server filesystem* path
// (e.g. /var/www/html/mpm/app/webroot/document/file/GRTL/GRTL_..._file.pdf) instead of
// something this Next.js app can actually serve.
//
// Usage:
//   node scripts/migrate-legacy-documents.mjs <local-folder-with-copied-files> [companyCode] [companyDbName]
//
// 1. Manually copy the physical files off the legacy server into <local-folder-with-copied-files>
//    (filenames must be kept as-is — matching is done by basename against document_path).
// 2. Run this script. It uploads each matched file to DigitalOcean Spaces (if SPACES_* env vars
//    are set in .env.local) or copies it into public/uploads/<companyCode>/documents/ otherwise,
//    then updates the corresponding document_upload row to the new, resolvable path.
// 3. Files with no local match are reported and left untouched.

import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const [, , localFolder, companyCode = 'GRTL', companyDbName = 'mypayrol_mpm121'] = process.argv;

if (!localFolder) {
  console.error('Usage: node scripts/migrate-legacy-documents.mjs <local-folder> [companyCode] [companyDbName]');
  process.exit(1);
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const spacesConfigured = ['SPACES_ENDPOINT', 'SPACES_REGION', 'SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET']
  .every((k) => !!process.env[k]);

async function uploadToSpaces(buffer, key, contentType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: `https://${process.env.SPACES_REGION}.digitaloceanspaces.com`,
    region: process.env.SPACES_REGION,
    credentials: { accessKeyId: process.env.SPACES_KEY, secretAccessKey: process.env.SPACES_SECRET },
  });
  await client.send(new PutObjectCommand({ Bucket: process.env.SPACES_BUCKET, Key: key, Body: buffer, ContentType: contentType, ACL: 'public-read' }));
  const cdnBase = process.env.SPACES_CDN_URL || `https://${process.env.SPACES_BUCKET}.${process.env.SPACES_REGION}.digitaloceanspaces.com`;
  return `${cdnBase}/${key}`;
}

function guessContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[ext] || 'application/octet-stream';
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.CONTROL_DB_HOST || 'localhost',
    user: process.env.CONTROL_DB_USER || 'root',
    password: process.env.CONTROL_DB_PASSWORD || '',
    database: companyDbName,
  });

  const [rows] = await conn.execute('SELECT document_upload_pkey, document_name, document_path FROM document_upload');
  const localFiles = new Set(readdirSync(localFolder));

  let updated = 0;
  const unmatched = [];

  for (const row of rows) {
    const basename = path.basename(row.document_path.replace(/\\/g, '/'));
    if (row.document_path.startsWith('/uploads/') || (spacesConfigured && row.document_path.startsWith('https://'))) {
      continue; // already a resolvable path (previously fixed, or a new-style upload)
    }
    if (!localFiles.has(basename)) {
      unmatched.push({ pkey: row.document_upload_pkey, name: row.document_name, basename });
      continue;
    }

    const localPath = path.join(localFolder, basename);
    const buffer = readFileSync(localPath);
    let newUrl;

    if (spacesConfigured) {
      newUrl = await uploadToSpaces(buffer, `${companyCode}/documents/${basename}`, guessContentType(basename));
    } else {
      const destDir = path.join(process.cwd(), 'public', 'uploads', companyCode, 'documents');
      mkdirSync(destDir, { recursive: true });
      copyFileSync(localPath, path.join(destDir, basename));
      newUrl = `/uploads/${companyCode}/documents/${basename}`;
    }

    await conn.execute('UPDATE document_upload SET document_path = ? WHERE document_upload_pkey = ?', [newUrl, row.document_upload_pkey]);
    updated++;
    console.log(`Updated #${row.document_upload_pkey} (${row.document_name}) -> ${newUrl}`);
  }

  console.log(`\n${updated} row(s) updated. Storage backend: ${spacesConfigured ? 'DigitalOcean Spaces' : 'local disk (public/uploads)'}.`);
  if (unmatched.length) {
    console.log(`${unmatched.length} row(s) had no matching local file (left untouched):`);
    for (const u of unmatched) console.log(`  #${u.pkey} "${u.name}" — expected file named "${u.basename}" in ${localFolder}`);
  }

  await conn.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
