import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/gdrive';
import { errorMessage } from '@/lib/http';
import { maskEmail } from '@/lib/format';
import { addAccount, listAccounts, updateAccount } from '@/lib/store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (message: string, key: 'error' | 'connected') =>
    NextResponse.redirect(`${url.origin}/files?${key}=${encodeURIComponent(message)}`);

  const error = url.searchParams.get('error');
  if (error) return back(error, 'error');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = (await cookies()).get('g_state')?.value;

  if (!code) return back('google did not send a code', 'error');
  if (!state || state !== expected) return back('oauth state mismatch, try connecting again', 'error');

  try {
    const { tokens, email } = await exchangeCode(code, `${url.origin}/api/oauth/google/callback`);
    const patch = {
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    };

    // akun google yang sama di-connect ulang: update tokennya, jangan bikin duplikat
    const existing = (await listAccounts()).find((account) => account.label === email);
    if (existing) await updateAccount(existing.id, patch);
    else await addAccount({ label: email, ...patch });

    const res = back(maskEmail(email), 'connected');
    res.cookies.delete('g_state');
    return res;
  } catch (err) {
    return back(errorMessage(err), 'error');
  }
}
