import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Account } from './types';

const DIR = process.env.DRIVEHUB_DATA_DIR ?? path.join(process.cwd(), '.data');
const FILE = path.join(DIR, 'accounts.json');

// tulisan diserialize: refresh token dari request paralel kalau ga diginiin bisa saling nimpa
let tail: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}

async function read(): Promise<Account[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as Account[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function write(accounts: Account[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE);
}

export function listAccounts(): Promise<Account[]> {
  return read();
}

export async function getAccount(id: string): Promise<Account | null> {
  return (await read()).find((account) => account.id === id) ?? null;
}

export function addAccount(input: Omit<Account, 'id' | 'createdAt'>): Promise<Account> {
  return serialize(async () => {
    const account: Account = { ...input, id: randomUUID(), createdAt: Date.now() };
    await write([...(await read()), account]);
    return account;
  });
}

export function updateAccount(id: string, patch: Partial<Account>): Promise<Account | null> {
  return serialize(async () => {
    const accounts = await read();
    const index = accounts.findIndex((account) => account.id === id);
    if (index === -1) return null;
    const updated: Account = { ...accounts[index], ...patch, id, createdAt: accounts[index].createdAt };
    accounts[index] = updated;
    await write(accounts);
    return updated;
  });
}

export function removeAccount(id: string): Promise<boolean> {
  return serialize(async () => {
    const accounts = await read();
    const kept = accounts.filter((account) => account.id !== id);
    if (kept.length === accounts.length) return false;
    await write(kept);
    return true;
  });
}
