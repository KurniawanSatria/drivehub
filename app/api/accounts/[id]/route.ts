import { NextResponse } from 'next/server';
import { fail, isSameOrigin } from '@/lib/http';
import { removeAccount } from '@/lib/store';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return fail('cross-origin request blocked', 403);

  const { id } = await params;
  const removed = await removeAccount(id);
  if (!removed) return NextResponse.json({ error: 'account not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}