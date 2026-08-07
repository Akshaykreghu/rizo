import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const REQUIRED_ENV = ['SPACES_ENDPOINT', 'SPACES_REGION', 'SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET'] as const;

function getClient() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) throw new Error(`Missing ${key} env var — DigitalOcean Spaces is not configured`);
  }
  return new S3Client({
    endpoint: `https://${process.env.SPACES_REGION}.digitaloceanspaces.com`,
    region: process.env.SPACES_REGION,
    credentials: {
      accessKeyId: process.env.SPACES_KEY!,
      secretAccessKey: process.env.SPACES_SECRET!,
    },
  });
}

export function isSpacesConfigured(): boolean {
  return REQUIRED_ENV.every((key) => !!process.env[key]);
}

// Uploads a file to the configured DigitalOcean Space (public-read, same access model
// as this app's previous local /uploads storage) and returns its public CDN URL.
export async function uploadToSpaces(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient();
  const bucket = process.env.SPACES_BUCKET!;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    })
  );
  const cdnBase = process.env.SPACES_CDN_URL || `https://${bucket}.${process.env.SPACES_REGION}.digitaloceanspaces.com`;
  return `${cdnBase}/${key}`;
}

export async function deleteFromSpaces(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: process.env.SPACES_BUCKET!, Key: key }));
}

// Extracts the object key from a full Spaces/CDN URL previously returned by uploadToSpaces.
export function keyFromSpacesUrl(url: string): string | null {
  if (!isSpacesConfigured()) return null;
  const bucket = process.env.SPACES_BUCKET!;
  const cdnBase = process.env.SPACES_CDN_URL || `https://${bucket}.${process.env.SPACES_REGION}.digitaloceanspaces.com`;
  if (!url.startsWith(`${cdnBase}/`)) return null;
  return url.slice(cdnBase.length + 1);
}

// Higher-level helpers for routes that store a bare filename in the DB (rather than a full
// resolvable path/URL) and reconstruct the download location separately — saves to Spaces when
// configured, falls back to local disk under public/uploads/ otherwise (dev-friendly, matches
// this app's existing local-disk convention).
export async function saveFile(
  companyCode: string,
  subpath: string,
  filename: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  if (isSpacesConfigured()) {
    await uploadToSpaces(buffer, `${companyCode}/${subpath}/${filename}`, contentType);
    return;
  }
  const dir = path.join(process.cwd(), 'public', 'uploads', companyCode, subpath);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);
}

export function resolveFileUrl(companyCode: string, subpath: string, filename: string): string {
  if (isSpacesConfigured()) {
    const bucket = process.env.SPACES_BUCKET!;
    const cdnBase = process.env.SPACES_CDN_URL || `https://${bucket}.${process.env.SPACES_REGION}.digitaloceanspaces.com`;
    return `${cdnBase}/${companyCode}/${subpath}/${filename}`;
  }
  return `/uploads/${companyCode}/${subpath}/${filename}`;
}
