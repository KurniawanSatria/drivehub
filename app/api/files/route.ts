import { NextResponse } from 'next/server';
import { listChildren } from '@/lib/gdrive';
import { errorMessage, fail } from '@/lib/http';
import { maskEmail } from '@/lib/format';
import { listAccounts } from '@/lib/store';
import type { RemoteFile } from '@/lib/types';

/** cursor = base64url dari JSON { accountId: pageToken }. tiap akun punya token sendiri */
function readCursor(raw: string | null): Record<string, string> | null {
  if (!raw) return {};
  if (raw.length > 4096) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const cursor: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') return null;
      cursor[key] = value;
    }
    return cursor;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get('account');
  const folderId = url.searchParams.get('folder');

  if (folderId && !/^[A-Za-z0-9_-]+$/.test(folderId)) return fail('invalid folder id', 400);

  const cursor = readCursor(url.searchParams.get('cursor'));
  if (cursor === null) return fail('invalid cursor', 400);

  // tanpa account: root semua akun sekaligus. dengan account: isi satu folder
  const accounts = accountId
    ? (await listAccounts()).filter((account) => account.id === accountId)
    : await listAccounts();

  if (accountId && accounts.length === 0) return fail('account not found', 404);

  const settled = await Promise.allSettled(
    accounts.map((account) => listChildren(account, folderId, cursor[account.id])),
  );

  const files: RemoteFile[] = [];
  const errors: { accountId: string; label: string; message: string }[] = [];
  const next: Record<string, string> = {};

  settled.forEach((result, index) => {
    const account = accounts[index];
    if (result.status !== 'fulfilled') {
      errors.push({ accountId: account.id, label: maskEmail(account.label), message: errorMessage(result.reason) });
      return;
    }
    files.push(...result.value.files);
    if (result.value.next) next[account.id] = result.value.next;
  });

  const token = Object.keys(next).length > 0 ? Buffer.from(JSON.stringify(next)).toString('base64url') : null;

  return NextResponse.json({ files, errors, total: files.length, next: token });
}
