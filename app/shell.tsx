'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBrandGoogleDrive,
  IconCloud,
  IconFolder,
  IconHome,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import classes from './navbar.module.css';
import { useConfirm } from './confirm';
import type { AccountView } from '@/lib/types';

const NAV = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/files', label: 'Files', icon: IconFolder },
];

export default function Shell({
  accounts,
  activeAccountId,
  onSelectAccount,
  onChanged,
  actions,
  dropAccountId,
  onAccountDragOver,
  onAccountDrop,
  children,
}: {
  accounts: AccountView[];
  activeAccountId: string | null;
  onSelectAccount: (id: string | null) => void;
  onChanged: () => void;
  actions?: React.ReactNode;
  /** target drop antar akun: id akun yang lagi di-hover, null kalau ga ada */
  dropAccountId?: string | null;
  onAccountDragOver?: (id: string | null) => void;
  onAccountDrop?: (id: string) => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [opened, { toggle, close }] = useDisclosure();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);

  // sync = refresh tampilan yang aktif dulu, terus jalanin ulang hitungan semua akun
  // (enumerasi penuh, makanya cache server-nya dibobol pakai fresh=1)
  async function sync() {
    if (syncing) return;
    setSyncing(true);
    onChanged();
    try {
      await fetch('/api/storage?fresh=1');
    } catch {
      // gagal sync statistik ga boleh ngehalangin refresh daftar file
    } finally {
      setSyncing(false);
      setLastSync(Date.now());
    }
  }

  const pick = (id: string | null) => {
    onSelectAccount(id);
    close();
  };

  async function disconnect(account: AccountView) {
    const proceed = await confirm({
      title: 'Disconnect account?',
      message: `${account.label} will be removed from DriveHUB.\n\nNothing is deleted from google drive.`,
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!proceed) return;
    await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' });
    if (activeAccountId === account.id) onSelectAccount(null);
    onChanged();
  }

  return (
    <AppShell
      className={classes.shell}
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="md" wrap="nowrap">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="toggle menu" />
          <Link href="/" className={classes.brand}>
            <Group gap="xs" wrap="nowrap">
              <IconCloud size={22} stroke={1.5} />
              <Title order={4}>DriveHUB</Title>
            </Group>
          </Link>
          {actions && (
            <Group gap="xs" ml="auto" wrap="nowrap">
              {actions}
            </Group>
          )}
          <Group gap="xs" wrap="nowrap" ml={actions ? undefined : 'auto'}>
            <Tooltip
              label={
                lastSync
                  ? `sync all accounts · last ${new Date(lastSync).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                  : 'sync all accounts'
              }
            >
              <ActionIcon
                variant="default"
                aria-label="sync all accounts"
                loading={syncing}
                onClick={() => void sync()}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={0}>
        <div className={classes.navbar}>
          <div className={classes.navList}>
            {NAV.map((item) => {
              const Icon = item.icon;
              const current = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${classes.account} ${classes.accountSolo}`}
                  data-active={current || undefined}
                >
                  <Icon size={16} stroke={1.5} />
                  <Text size="sm" truncate>
                    {item.label}
                  </Text>
                </Link>
              );
            })}
          </div>

          <div className={classes.label}>google accounts ({accounts.length})</div>

          <div className={classes.accounts}>
            <button
              type="button"
              className={`${classes.account} ${classes.accountSolo}`}
              data-active={activeAccountId === null || undefined}
              onClick={() => pick(null)}
            >
              <IconCloud size={16} stroke={1.5} />
              <Text size="sm" truncate>
                All accounts
              </Text>
            </button>
            {accounts.map((account) => (
              <Group key={account.id} className={classes.row} gap={2} wrap="nowrap">
                <button
                  type="button"
                  className={classes.account}
                  data-active={activeAccountId === account.id || undefined}
                  data-drop={dropAccountId === account.id || undefined}
                  onDragOver={(event) => {
                    if (!onAccountDragOver) return;
                    event.preventDefault();
                    onAccountDragOver(account.id);
                  }}
                  onDragLeave={() => onAccountDragOver?.(null)}
                  onDrop={(event) => {
                    if (!onAccountDrop) return;
                    event.preventDefault();
                    onAccountDrop(account.id);
                  }}
                  onClick={() => pick(activeAccountId === account.id ? null : account.id)}
                >
                  <IconBrandGoogleDrive size={16} stroke={1.5} />
                  <Text size="sm" truncate>
                    {account.label}
                  </Text>
                </button>
                <Tooltip label="disconnect" position="right">
                  <ActionIcon
                    className={classes.trash}
                    variant="subtle"
                    color="red"
                    aria-label={`disconnect ${account.label}`}
                    onClick={() => void disconnect(account)}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
            {accounts.length === 0 && (
              <Text size="xs" c="dimmed" px="sm">
                nothing connected yet
              </Text>
            )}
          </div>

          <div className={classes.footer}>
            <Button component="a" href="/api/oauth/google" fullWidth leftSection={<IconBrandGoogleDrive size={16} />}>
              Connect Google Drive
            </Button>
          </div>
        </div>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>

      {confirmDialog}
    </AppShell>
  );
}
