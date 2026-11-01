'use client';

import { Card, ColorSwatch, Group, Progress, SimpleGrid, Skeleton, Stack, Text, Tooltip } from '@mantine/core';
import { formatSize } from '@/lib/format';

export type Segment = { key: string; bytes: number; count: number };
export type LargestFile = { id: string; name: string; size: number; mimeType: string; accountId: string };

export type StorageRow = {
  accountId: string;
  label: string;
  limit: number | null;
  usage: number | null;
  usageInTrash: number | null;
  segments: Segment[];
  scanned: number;
  partial: boolean;
  largest: LargestFile[];
};

export const SEGMENT_COLORS: Record<string, string> = {
  video: 'grape',
  image: 'teal',
  audio: 'yellow',
  pdf: 'red',
  document: 'blue',
  spreadsheet: 'green',
  presentation: 'orange',
  archive: 'gray',
  other: 'indigo',
};

export function segmentColor(key: string): string {
  return SEGMENT_COLORS[key] ?? 'gray';
}

export function StorageSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} height={190} radius="md" />
      ))}
    </SimpleGrid>
  );
}

export default function StorageCards({ rows }: { rows: StorageRow[] }) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
      {rows.map((row) => {
        const typed = row.segments.reduce((sum, segment) => sum + segment.bytes, 0);
        const percent = row.limit && row.usage ? Math.min(100, (row.usage / row.limit) * 100) : null;

        return (
          <Card key={row.accountId} withBorder radius="md" padding="md">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm" fw={600} truncate title={row.label}>
                {row.label}
              </Text>
              {percent !== null && (
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {percent.toFixed(1)}%
                </Text>
              )}
            </Group>

            <Text size="xl" fw={700} mt={4}>
              {formatSize(row.usage)}
              <Text span size="sm" c="dimmed" fw={400}>
                {row.limit ? ` of ${formatSize(row.limit)}` : ' used'}
              </Text>
            </Text>

            {percent !== null && (
              <Progress.Root size="lg" radius="xl" mt="xs">
                <Progress.Section value={percent} color={percent > 90 ? 'red' : 'blue'} />
              </Progress.Root>
            )}

            <Text size="xs" c="dimmed" mt="md">
              by file type · {row.scanned} files
              {row.partial ? ' (partial, only the first 10k counted)' : ''}
            </Text>

            <Progress.Root size="lg" radius="xl" mt="xs">
              {row.segments.map((segment) => (
                <Progress.Section
                  key={segment.key}
                  value={(segment.bytes / typed) * 100}
                  color={segmentColor(segment.key)}
                />
              ))}
            </Progress.Root>

            <Group gap="sm" mt="xs">
              {row.segments.map((segment) => (
                <Tooltip key={segment.key} label={`${segment.count} files`}>
                  <Group gap={5} wrap="nowrap">
                    <ColorSwatch size={9} color={`var(--mantine-color-${segmentColor(segment.key)}-filled)`} />
                    <Text size="xs" c="dimmed">
                      {segment.key} {formatSize(segment.bytes)}
                    </Text>
                  </Group>
                </Tooltip>
              ))}
            </Group>

            {row.usageInTrash ? (
              <Text size="xs" c="dimmed" mt="sm">
                {formatSize(row.usageInTrash)} of that sits in trash
              </Text>
            ) : null}
          </Card>
        );
      })}

      {rows.length === 0 && (
        <Stack>
          <Text size="sm" c="dimmed">
            no accounts connected yet
          </Text>
        </Stack>
      )}
    </SimpleGrid>
  );
}
