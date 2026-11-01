import { thumbnail } from '@/lib/gdrive';
import { getAccount } from '@/lib/store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get('account');
  const fileId = url.searchParams.get('id');
  if (!accountId || !fileId) return new Response(null, { status: 400 });

  const account = await getAccount(accountId);
  if (!account) return new Response(null, { status: 404 });

  const sizeRaw = url.searchParams.get('size');
  if (sizeRaw && !/^\d{1,4}$/.test(sizeRaw)) return new Response(null, { status: 400 });
  const size = sizeRaw ? Number(sizeRaw) : null;

  try {
    const image = await thumbnail(account, fileId, size);
    if (!image) return new Response(null, { status: 404 });
    return new Response(image.body, { status: 200, headers: image.headers });
  } catch {
    // <img> cuma butuh tau gagal, detailnya ga berguna di sini
    return new Response(null, { status: 404 });
  }
}
