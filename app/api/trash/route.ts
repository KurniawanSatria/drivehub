import { NextResponse } from 'next/server';
import { trashFile } from '@/lib/gdrive';
import { fail, isJson, isSameOrigin } from '@/lib/http';
import { getAccount } from '@/lib/store';

const ID = /^[A-Za-z0-9_-]+$/;

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return fail('cross-origin request blocked', 403);
  if (!isJson(req)) return fail('content-type must be application/json', 415);

  const body = (await req.json().catch(() => null)) as { account?: string; fileId?: string } | null;
  if (!body?.account || !body?.fileId) return fail('account and fileId are required', 400);
  if (!ID.test(body.fileId)) return fail('invalid fileId', 400);

  const account = await getAccount(body.account);
  if (!account) return fail('account not found', 404);

  try {
    await trashFile(account, body.fileId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err, 502);
  }
}
