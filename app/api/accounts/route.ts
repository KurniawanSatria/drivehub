import { NextResponse } from 'next/server';
import { listAccounts } from '@/lib/store';
import { toAccountView } from '@/lib/types';

export async function GET() {
  const accounts = await listAccounts();
  return NextResponse.json({ accounts: accounts.map(toAccountView) });
}
