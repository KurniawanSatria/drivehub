'use client';

import { useCallback, useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** aksi yang ga bisa dibalikin: tombolnya merah */
  danger?: boolean;
};

type Pending = { options: ConfirmOptions; resolve: (ok: boolean) => void };

/** pengganti window.confirm, tapi pakai modal mantine biar ikut tema */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
  };

  const dialog = (
    <Modal opened={pending !== null} onClose={() => settle(false)} title={pending?.options.title} centered>
      <Stack gap="lg">
        {pending?.options.message && (
          <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
            {pending.options.message}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => settle(false)}>
            {pending?.options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button color={pending?.options.danger ? 'red' : undefined} onClick={() => settle(true)}>
            {pending?.options.confirmLabel ?? 'Confirm'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return { confirm, dialog };
}