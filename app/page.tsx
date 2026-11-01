'use client';

import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Card,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import Shell from './shell';
import StorageCards, { StorageSkeleton, type StorageRow } from './storage';
import { formatSize } from '@/lib/format';
import classes from './navbar.module.css';
import type { AccountView } from '@/lib/types';

type Errors = { accountId: string; label: string; message: string }[];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={2} truncate>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [rows, setRows] = useState<StorageRow[]>([]);
  const [errors, setErrors] = useState<Errors>([]);
  const [active, setActive] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    // refreshKey > 0 artinya user minta reload, jadi cache server-nya dibobol
    void Promise.all([
      fetch('/api/accounts').then((res) => res.json()),
      fetch(`/api/storage${refreshKey > 0 ? '?fresh=1' : ''}`).then((res) => res.json()),
    ])
      .then(([accountData, storageData]) => {
        if (!alive) return;
        setAccounts(accountData.accounts ?? []);
        setRows(storageData.accounts ?? []);
        setErrors(storageData.errors ?? []);
      })
      .catch((err) => {
        if (!alive) return;
        setErrors([{ accountId: '', label: 'app', message: err instanceof Error ? err.message : String(err) }]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const visible = active ? rows.filter((row) => row.accountId === active) : rows;
  const used = visible.reduce((sum, row) => sum + (row.usage ?? 0), 0);
  const scanned = visible.reduce((sum, row) => sum + row.scanned, 0);

  const byType = new Map<string, number>();
  for (const row of visible) {
    for (const segment of row.segments) {
      byType.set(segment.key, (byType.get(segment.key) ?? 0) + segment.bytes);
    }
  }
  const biggestType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
  const counted = [...byType.values()].reduce((sum, bytes) => sum + bytes, 0);

  const largest = visible
    .flatMap((row) => row.largest.map((file) => ({ ...file, label: row.label })))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  return (
    <Shell
      accounts={accounts}
      activeAccountId={active}
      onSelectAccount={setActive}
      onChanged={() => setRefreshKey((key) => key + 1)}
    >
      <Stack gap="lg">
        <div>
          <Title order={3}>Overview</Title>
          <Text size="sm" c="dimmed">
            quota comes from google. the split by type is counted from your own files, so it can be lower than the
            quota (gmail, photos and trashed items are not counted here).
          </Text>
        </div>

        {accounts.length === 0 && !loading && (
          <Alert color="blue" title="No accounts connected yet">
            click <b>Connect Google Drive</b> on the left to link an account.
          </Alert>
        )}

        {errors.map((err) => (
          <Alert key={err.accountId} color="red" title={`failed to read ${err.label}`} className={classes.selectable}>
            {err.message}
          </Alert>
        ))}

        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
          <Tile label="accounts" value={String(visible.length)} sub={`${accounts.length} connected`} />
          <Tile label="used in total" value={formatSize(used)} sub="includes gmail + photos + trash" />
          <Tile
            label="files counted"
            value={String(scanned)}
            sub={visible.some((row) => row.partial) ? 'partial, one account is capped at 10k' : 'owned by these accounts'}
          />
          <Tile
            label="biggest type"
            value={biggestType ? biggestType[0] : '-'}
            sub={biggestType ? `${formatSize(biggestType[1])} of ${formatSize(counted)}` : 'nothing counted yet'}
          />
        </SimpleGrid>

        {loading && rows.length === 0 ? <StorageSkeleton /> : <StorageCards rows={visible} />}

        {largest.length > 0 && (
          <Card withBorder radius="md" padding="md">
            <Text fw={600} mb="xs">
              Largest files
            </Text>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>name</Table.Th>
                  <Table.Th>account</Table.Th>
                  <Table.Th>size</Table.Th>
                  <Table.Th aria-label="actions" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {largest.map((file) => (
                  <Table.Tr key={`${file.accountId}:${file.id}`}>
                    <Table.Td>
                      <Text size="sm" truncate maw={520} title={file.name} className={classes.selectable}>
                        {file.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {file.label.split('@')[0]}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatSize(file.size)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="download">
                        <ActionIcon
                          component="a"
                          variant="subtle"
                          aria-label={`download ${file.name}`}
                          href={`/api/download?account=${file.accountId}&id=${encodeURIComponent(file.id)}`}
                        >
                          <IconDownload size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}
      </Stack>
    </Shell>
  );
}
