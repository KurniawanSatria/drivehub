import { randomUUID } from 'node:crypto';
import { attachment } from './http';
import { fileCategory, maskEmail } from './format';
import { updateAccount } from './store';
import type { Account, RemoteFile } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const ABOUT = 'https://www.googleapis.com/drive/v3/about';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const GOOGLE_SCOPES = [
  // write dipakai buat pindah folder, copy antar akun, dan nge-trash. akun lama yang
  // cuma punya drive.readonly harus connect ulang biar dapet izin ini
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// file google docs ga punya byte asli, harus di-export ke format office dulu
const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.spreadsheet':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.drawing': 'image/png',
};

const EXPORT_EXT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/png': '.png',
};

// script, prompt ai studio, form, dll cuma ada di dalam google, ga punya byte buat diunduh.
// prefix-nya sengaja 'application/vnd.google' bukan '...google-apps.', karena keluarga
// google-makersuite juga item internal yang ga punya byte.
function isDownloadable(mimeType: string): boolean {
  if (!mimeType.startsWith('application/vnd.google')) return true;
  return Boolean(EXPORT_MIME[mimeType]);
}

// folder tetap ditampilin (dia yang bisa diklik), item internal yang ga punya byte dibuang
function isVisible(mimeType: string): boolean {
  return mimeType === FOLDER_MIME || isDownloadable(mimeType);
}

function env(name: 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set, add it to .env.local`);
  return value;
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string };

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`google oauth ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const tokens = await postToken({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!res.ok) throw new Error(`could not read the google account email: ${res.status}`);
  const { email } = (await res.json()) as { email: string };
  return { tokens, email };
}

async function refresh(account: Account): Promise<Account> {
  if (!account.refreshToken) throw new Error(`${maskEmail(account.label)} has no refresh token, reconnect the account`);
  const tokens = await postToken({ refresh_token: account.refreshToken, grant_type: 'refresh_token' });
  const patch = { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  const updated = await updateAccount(account.id, patch);
  return updated ?? { ...account, ...patch };
}

async function accessToken(account: Account): Promise<string> {
  if (account.accessToken && (account.expiresAt ?? 0) > Date.now() + 60_000) return account.accessToken;
  return (await refresh(account)).accessToken!;
}

async function api(account: Account, url: string, init?: RequestInit): Promise<Response> {
  const send = async (acc: Account) =>
    fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${await accessToken(acc)}` } });

  let res = await send(account);
  if (res.status === 401) res = await send(await refresh(account));
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 403 && /insufficient|scope/i.test(text)) {
      throw new Error(`${maskEmail(account.label)} cuma punya izin baca, reconnect akunnya buat dapet izin tulis`);
    }
    throw new Error(`google drive ${res.status}: ${text}`);
  }
  return res;
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  parents?: string[];
};

async function getMeta(account: Account, fileId: string): Promise<DriveFile> {
  const res = await api(
    account,
    `${DRIVE}/${fileId}?fields=id,name,mimeType,size,parents&supportsAllDrives=true`,
  );
  return (await res.json()) as DriveFile;
}

/** metadata satu file. dipakai juga sama route zip buat tau ukuran file-nya */
export function fileMeta(account: Account, fileId: string): Promise<DriveFile> {
  return getMeta(account, fileId);
}

/** baca potongan byte aja. dipakai buat ngebaca central directory zip di ekor file */
export async function readRange(
  account: Account,
  fileId: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const upstream = await api(account, `${DRIVE}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  return Buffer.from(await upstream.arrayBuffer());
}

export type Listing = { files: RemoteFile[]; more: boolean; next: string | null };

export async function listChildren(
  account: Account,
  folderId: string | null,
  pageToken?: string | null,
): Promise<Listing> {
  // folderId datang dari client dan masuk ke dalem string query drive, jadi harus divalidasi
  if (folderId && !/^[A-Za-z0-9_-]+$/.test(folderId)) throw new Error('invalid folder id');

  const params = new URLSearchParams({
    // 1000 = maksimum yang diterima drive. pageToken dipakai kalau foldernya lebih dari itu
    pageSize: '1000',
    orderBy: 'folder,name_natural',
    // 'me' in owners: tanpa itu google ikut narik file yang cuma di-share ke akun ini
    q: `'${folderId ?? 'root'}' in parents and trashed = false and 'me' in owners`,
    fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink),nextPageToken',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await api(account, `${DRIVE}?${params}`);
  const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
  const files = (body.files ?? [])
    .filter((file) => isVisible(file.mimeType))
    .map((file) => ({
      id: file.id,
      name: file.name,
      size: file.size ? Number(file.size) : null,
      modifiedAt: file.modifiedTime ?? null,
      mimeType: file.mimeType,
      thumbnail: Boolean(file.thumbnailLink),
      webViewLink: file.webViewLink ?? null,
      accountId: account.id,
      accountLabel: maskEmail(account.label),
    }));

  const next = body.nextPageToken ?? null;
  return { files, more: Boolean(next), next };
}

export async function thumbnail(
  account: Account,
  fileId: string,
  size?: number | null,
): Promise<Response | null> {
  // link thumbnail punya tanda tangan yang cepet kadaluarsa, jadi minta yang baru tiap kali
  const meta = await api(account, `${DRIVE}/${fileId}?fields=thumbnailLink&supportsAllDrives=true`);
  const { thumbnailLink } = (await meta.json()) as Pick<DriveFile, 'thumbnailLink'>;
  if (!thumbnailLink) return null;

  // google balikin ukuran default (220px). suffix `=s<n>` bisa diganti sesuai ukuran kartu:
  // hemat bandwidth di kartu kecil, ga blur di kartu gede
  const wanted = size && size >= 64 ? Math.min(1600, Math.round(size)) : 220;
  const link = thumbnailLink.replace(/=s\d+/, `=s${wanted}`);

  const image = await fetch(link);
  if (!image.ok) return null;
  return new Response(image.body, {
    headers: {
      'Content-Type': image.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export async function download(
  account: Account,
  fileId: string,
  options: { range?: string | null; inline?: boolean } = {},
): Promise<Response> {
  const info = await getMeta(account, fileId);

  if (info.mimeType === FOLDER_MIME) throw new Error('cannot download a folder');
  if (!isDownloadable(info.mimeType)) {
    throw new Error(`${info.mimeType} cannot be downloaded directly, open it in google drive`);
  }

  const exportMime = EXPORT_MIME[info.mimeType];
  if (exportMime) {
    const upstream = await api(account, `${DRIVE}/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`);
    const name = info.name + (EXPORT_EXT[exportMime] ?? '');
    return new Response(upstream.body, {
      headers: {
        'Content-Type': exportMime,
        ...(options.inline ? {} : { 'Content-Disposition': attachment(name) }),
      },
    });
  }

  // Range diterusin biar <video>/<audio> bisa seek dan ga perlu unduh seluruh file dulu
  const upstream = await api(account, `${DRIVE}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: options.range ? { Range: options.range } : undefined,
  });

  const headers = new Headers({
    'Content-Type': info.mimeType ?? 'application/octet-stream',
    'Accept-Ranges': upstream.headers.get('accept-ranges') ?? 'bytes',
  });
  if (!options.inline) headers.set('Content-Disposition', attachment(info.name));
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}

export type StorageSegment = { key: string; bytes: number; count: number };

export type LargestFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  accountId: string;
};

export type StorageReport = {
  limit: number | null;
  usage: number | null;
  usageInTrash: number | null;
  segments: StorageSegment[];
  scanned: number;
  partial: boolean;
  largest: LargestFile[];
};

// shortcut: maks 10 halaman x 1000 file buat itung pemakaian per tipe. drive gede di atas
// 10 ribu file bakal ditandain partial: true, upgrade ke hitungan per-halaman kalau perlu presisi
const PAGE_CAP = 10;

function categoryOf(mimeType: string): string {
  return fileCategory(mimeType);
}

export async function storage(account: Account): Promise<StorageReport> {
  const aboutRes = await api(account, `${ABOUT}?fields=storageQuota`);
  const { storageQuota } = (await aboutRes.json()) as {
    storageQuota?: { limit?: string; usage?: string; usageInDriveTrash?: string };
  };

  const totals = new Map<string, StorageSegment>();
  const largest: LargestFile[] = [];
  let pageToken: string | undefined;
  let scanned = 0;
  let partial = false;
  let page = 0;

  while (page < PAGE_CAP) {
    const params = new URLSearchParams({
      pageSize: '1000',
      q: "trashed = false and 'me' in owners",
      fields: 'nextPageToken,files(id,name,mimeType,size)',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await api(account, `${DRIVE}?${params}`);
    const body = (await res.json()) as {
      files?: { id: string; name: string; mimeType: string; size?: string }[];
      nextPageToken?: string;
    };

    for (const file of body.files ?? []) {
      scanned += 1;
      const key = categoryOf(file.mimeType);
      const segment = totals.get(key) ?? { key, bytes: 0, count: 0 };
      segment.bytes += Number(file.size ?? 0);
      segment.count += 1;
      totals.set(key, segment);

      if (file.size) {
        largest.push({
          id: file.id,
          name: file.name,
          size: Number(file.size),
          mimeType: file.mimeType,
          accountId: account.id,
        });
      }
    }

    page += 1;
    pageToken = body.nextPageToken;
    if (!pageToken) break;
    if (page === PAGE_CAP) partial = true;
  }

  const numberOrNull = (value?: string) => (value ? Number(value) : null);

  return {
    limit: numberOrNull(storageQuota?.limit),
    usage: numberOrNull(storageQuota?.usage),
    usageInTrash: numberOrNull(storageQuota?.usageInDriveTrash),
    segments: [...totals.values()].filter((segment) => segment.bytes > 0).sort((a, b) => b.bytes - a.bytes),
    scanned,
    partial,
    largest: largest.sort((a, b) => b.size - a.size).slice(0, 10),
  };
}

// --- pindah file: satu akun cuma ganti parent, antar akun copy byte-nya lalu aslinya di-trash

const rootIds = new Map<string, string>();

async function rootFolderId(account: Account): Promise<string> {
  const hit = rootIds.get(account.id);
  if (hit) return hit;
  const res = await api(account, `${DRIVE}/root?fields=id`);
  const { id } = (await res.json()) as { id: string };
  rootIds.set(account.id, id);
  return id;
}

/** pindah dalam satu akun: file tetap punya id, share, dan owner yang sama */
export async function moveFile(account: Account, fileId: string, targetFolder: string | null): Promise<void> {
  const meta = await getMeta(account, fileId);
  const target = targetFolder ?? (await rootFolderId(account));
  const parents = meta.parents ?? [];

  // udah ada di situ, ga usah manggil google
  if (parents.includes(target)) return;

  const params = new URLSearchParams({ addParents: target, supportsAllDrives: 'true', fields: 'id,parents' });
  if (parents.length > 0) params.set('removeParents', parents.join(','));

  await api(account, `${DRIVE}/${fileId}?${params}`, { method: 'PATCH' });
}

/** trashed: true = masuk trash, masih bisa dipulihin. files.delete itu hapus permanen */
export async function trashFile(account: Account, fileId: string): Promise<void> {
  await api(account, `${DRIVE}/${fileId}?fields=id,trashed`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

/** copy antar akun: alirkan byte dari sumber ke upload google, ga ditahan di memori */
export async function copyFile(
  source: Account,
  fileId: string,
  target: Account,
  targetFolder: string | null,
): Promise<string> {
  const meta = await getMeta(source, fileId);
  if (meta.mimeType === FOLDER_MIME) {
    throw new Error('folder ga bisa dipindah antar akun, pindahin isinya satu-satu');
  }

  const exportMime = EXPORT_MIME[meta.mimeType];
  if (meta.mimeType.startsWith('application/vnd.google') && !exportMime) {
    throw new Error(`${meta.mimeType} ga bisa dipindah antar akun, buka di google drive`);
  }

  const bytes = await download(source, fileId, { inline: true });
  if (!bytes.body) throw new Error(`isi ${meta.name} kosong`);

  const parent = targetFolder ?? (await rootFolderId(target));
  const boundary = `drivehub-${randomUUID()}`;
  const encoder = new TextEncoder();
  const payload = {
    name: exportMime ? meta.name + (EXPORT_EXT[exportMime] ?? '') : meta.name,
    mimeType: exportMime ?? meta.mimeType,
    parents: [parent],
  };

  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(payload)}\r\n` +
      `--${boundary}\r\nContent-Type: ${payload.mimeType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);

  const upstream = bytes.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(head);
      for (;;) {
        const { done, value } = await upstream.read();
        if (done) break;
        controller.enqueue(value);
      }
      controller.enqueue(tail);
      controller.close();
    },
  });

  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken(target)}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 403 && /insufficient|scope/i.test(text)) {
      throw new Error(`${maskEmail(target.label)} cuma punya izin baca, reconnect akunnya buat dapet izin tulis`);
    }
    throw new Error(`upload ke ${maskEmail(target.label)} gagal ${res.status}: ${text}`);
  }

  const { id } = (await res.json()) as { id: string };
  return id;
}
