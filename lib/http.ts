import { NextResponse } from 'next/server';

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function fail(err: unknown, status = 500) {
  return NextResponse.json({ error: errorMessage(err) }, { status });
}

/**
 * gerbang buat route yang ngubah data (move, trash, disconnect).
 * tanpa ini, halaman web mana pun yang kebuka di browser user bisa nembak
 * http://localhost:3000/api/trash dan ngehapus file, karena request lintas origin tetap
 * dikirim ke server (yang ga bisa dibaca cuma response-nya).
 * sec-fetch-site diset browser dan ga bisa dipalsuin dari javascript halaman.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;

  const origin = req.headers.get('origin');
  if (!origin) return true; // curl / klien non-browser
  return origin === new URL(req.url).origin;
}

/** lapisan kedua: simple request lintas origin ga bisa masang content-type json tanpa preflight */
export function isJson(req: Request): boolean {
  return (req.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

function asciiName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

export function attachment(name: string): string {
  return `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'text/xml',
  zip: 'application/zip',
};

export function mimeFromName(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
