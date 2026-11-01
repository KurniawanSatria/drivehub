import { NextResponse } from 'next/server';
import { copyFile, moveFile, trashFile } from '@/lib/gdrive';
import { fail, isJson, isSameOrigin } from '@/lib/http';
import { getAccount } from '@/lib/store';

const ID = /^[A-Za-z0-9_-]+$/;

type Payload = { source?: string; fileId?: string; target?: string; folder?: string | null };

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return fail('cross-origin request blocked', 403);
  if (!isJson(req)) return fail('content-type must be application/json', 415);

  const body = (await req.json().catch(() => null)) as Payload | null;
  if (!body) return fail('body must be json', 400);

  const { source, fileId, target } = body;
  const folder = body.folder ?? null;
  if (!source || !fileId || !target) return fail('source, fileId and target are required', 400);

  // id-nya masuk ke url google, jadi jangan diterima mentah-mentah
  if (!ID.test(fileId)) return fail('invalid fileId', 400);
  if (folder && !ID.test(folder)) return fail('invalid folder id', 400);

  const from = await getAccount(source);
  const to = await getAccount(target);
  if (!from || !to) return fail('account not found', 404);

  try {
    if (source === target) {
      await moveFile(from, fileId, folder);
      return NextResponse.json({ ok: true, mode: 'move' });
    }

    // antar akun: ga ada cara pindah langsung, jadi copy dulu baru aslinya di-trash
    await copyFile(from, fileId, to, folder);
    await trashFile(from, fileId);
    return NextResponse.json({ ok: true, mode: 'copy' });
  } catch (err) {
    return fail(err, 502);
  }
}
