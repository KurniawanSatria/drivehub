import { download } from '@/lib/gdrive';
import { fail } from '@/lib/http';
import { getAccount } from '@/lib/store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get('account');
  const fileId = url.searchParams.get('id');
  if (!accountId || !fileId) return fail('the account and id parameters are required', 400);

  const account = await getAccount(accountId);
  if (!account) return fail('account not found', 404);

  try {
    const upstream = await download(account, fileId, {
      range: req.headers.get('range'),
      inline: url.searchParams.has('inline'),
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch (err) {
    return fail(err, 502);
  }
}
