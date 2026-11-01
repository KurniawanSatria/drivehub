import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { fileMeta } from '@/lib/gdrive';
import { attachment, fail, mimeFromName } from '@/lib/http';
import { getAccount } from '@/lib/store';
import { driveReader, listZipEntries, openZipEntry } from '@/lib/zip';

const ID = /^[A-Za-z0-9_-]+$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get('account');
  const fileId = url.searchParams.get('id');
  const entry = url.searchParams.get('entry');
  if (!accountId || !fileId) return fail('the account and id parameters are required', 400);
  if (!ID.test(fileId)) return fail('invalid fileId', 400);

  const account = await getAccount(accountId);
  if (!account) return fail('account not found', 404);

  try {
    const meta = await fileMeta(account, fileId);
    const size = meta.size ? Number(meta.size) : 0;
    if (!size) return fail('file ini ga ada ukurannya, ga bisa dibaca sebagai zip', 400);

    const reader = driveReader(account, fileId, size);

    if (!entry) {
      const { entries, truncated } = await listZipEntries(reader, size);
      return NextResponse.json({ name: meta.name, size, entries, truncated });
    }

    const stream = await openZipEntry(reader, size, entry);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': mimeFromName(entry),
        'Content-Disposition': attachment(entry.split('/').pop() || entry),
      },
    });
  } catch (err) {
    return fail(err, 502);
  }
}