import { NextResponse } from 'next/server';
import { storage, type StorageReport } from '@/lib/gdrive';
import { maskEmail } from '@/lib/format';
import { errorMessage } from '@/lib/http';
import { listAccounts } from '@/lib/store';

// ngitung pemakaian itu ngepage seluruh drive, jadi hasilnya di-cache bentar biar pindah
// halaman ga ngehit ulang google
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; report: StorageReport }>();

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has('fresh');
  const accounts = await listAccounts();

  const settled = await Promise.allSettled(
    accounts.map(async (account) => {
      const hit = cache.get(account.id);
      if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return { account, report: hit.report };

      const report = await storage(account);
      cache.set(account.id, { at: Date.now(), report });
      return { account, report };
    }),
  );

  const rows: ({ accountId: string; label: string } & StorageReport)[] = [];
  const errors: { accountId: string; label: string; message: string }[] = [];

  settled.forEach((result, index) => {
    const account = accounts[index];
    if (result.status === 'fulfilled') rows.push({ accountId: account.id, label: maskEmail(account.label), ...result.value.report });
    else errors.push({ accountId: account.id, label: maskEmail(account.label), message: errorMessage(result.reason) });
  });

  return NextResponse.json({ accounts: rows, errors });
}
