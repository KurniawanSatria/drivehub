export function formatSize(size: number | null): string {
  if (size == null) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

/** s*****@gmail.com. dipakai di semua yang dikirim ke browser, biar email ga pernah bocor ke ui */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return value;
  return `${value[0]}*****${value.slice(at)}`;
}

/**
 * kategori file buat pengelompokan (dashboard) dan sort by type (halaman files).
 * satu sumber biar angka di dashboard dan urutan di browser ga beda.
 */
export function fileCategory(mimeType: string | null, name = ''): string {
  const mime = mimeType ?? '';

  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime === 'text/csv') return 'spreadsheet';
  if (mime.includes('presentation')) return 'presentation';
  if (mime.includes('document') || mime.startsWith('text/')) return 'document';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return 'archive';

  // mime ga ada (jarang di drive): tebak dari ekstensi
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'txt', 'md', 'json'].includes(ext)) return 'document';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'spreadsheet';
  if (['ppt', 'pptx'].includes(ext)) return 'presentation';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';

  return 'other';
}
