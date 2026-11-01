import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { fail } from '@/lib/http';
import { googleAuthUrl } from '@/lib/gdrive';

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const state = randomUUID();

  try {
    const res = NextResponse.redirect(googleAuthUrl(`${origin}/api/oauth/google/callback`, state));
    res.cookies.set('g_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
    return res;
  } catch (err) {
    return fail(err);
  }
}
