'use client';

import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Group,
  Modal,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconDownload, IconFileZip } from '@tabler/icons-react';
import classes from './navbar.module.css';
import { formatSize } from '@/lib/format';
import type { RemoteFile } from '@/lib/types';

export type PreviewKind = 'image' | 'video' | 'audio' | 'zip' | 'none';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac']);

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

export function previewKind(file: RemoteFile): PreviewKind {
  const mime = file.mimeType ?? '';
  const ext = extensionOf(file.name);

  if (mime.startsWith('image/') || (!mime && IMAGE_EXT.has(ext))) return 'image';
  if (mime.startsWith('video/') || (!mime && VIDEO_EXT.has(ext))) return 'video';
  if (mime.startsWith('audio/') || (!mime && AUDIO_EXT.has(ext))) return 'audio';
  if (ext === 'zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'zip';
  return 'none';
}

/** inline=1 bikin server ga masang content-disposition attachment, jadi aman dipasang di <img>/<video> */
export function previewUrl(file: RemoteFile): string {
  return `/api/download?account=${file.accountId}&id=${encodeURIComponent(file.id)}&inline=1`;
}

export function thumbUrl(file: RemoteFile, size?: number): string {
  const query = `/api/thumb?account=${file.accountId}&id=${encodeURIComponent(file.id)}`;
  return size ? `${query}&size=${size}` : query;
}

export function downloadUrl(file: RemoteFile): string {
  return `/api/download?account=${file.accountId}&id=${encodeURIComponent(file.id)}`;
}

function zipEntryUrl(file: RemoteFile, entry: string): string {
  return `/api/zip?account=${file.accountId}&id=${encodeURIComponent(file.id)}&entry=${encodeURIComponent(entry)}`;
}

type Entry = { name: string; size: number; compressedSize: number };

/** isi zip dibaca dari central directory di ekor file, jadi zip 2GB pun ga perlu diunduh utuh */
function ZipList({ file }: { file: RemoteFile }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch(`/api/zip?account=${file.accountId}&id=${encodeURIComponent(file.id)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `failed (${res.status})`);
        if (!alive) return;
        setEntries(data.entries ?? []);
        setTruncated(data.truncated ?? false);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [file.accountId, file.id]);

  if (loading) return <Skeleton height={240} radius="md" />;
  if (error) {
    return (
      <Stack gap="xs">
        <Text size="sm" c="red">
          {error}
        </Text>
        <Anchor size="sm" href={downloadUrl(file)}>
          Download the whole zip instead
        </Anchor>
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed">
        {entries.length} files inside{truncated ? ' (first 500 only)' : ''} · ambil satu file tanpa
        ngunduh zip-nya
      </Text>

      <ScrollArea h={380} type="auto">
        <Stack gap={2}>
          {entries.map((entry) => (
            <Group key={entry.name} className={classes.zipRow} gap="xs" wrap="nowrap">
              <IconFileZip size={16} />
              <Text size="sm" truncate style={{ flex: 1 }} title={entry.name}>
                {entry.name}
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {formatSize(entry.size)}
              </Text>
              <Tooltip label="download this file">
                <ActionIcon
                  component="a"
                  href={zipEntryUrl(file, entry.name)}
                  variant="subtle"
                  aria-label={`download ${entry.name}`}
                >
                  <IconDownload size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

export default function PreviewModal({
  file,
  files,
  onNavigate,
  onClose,
}: {
  file: RemoteFile | null;
  /** daftar yang lagi keliatan (urutan sort + filter), buat next/prev */
  files: RemoteFile[];
  onNavigate: (file: RemoteFile) => void;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const kind = file ? previewKind(file) : 'none';

  const index = file ? files.findIndex((item) => item.accountId === file.accountId && item.id === file.id) : -1;
  const prev = index > 0 ? files[index - 1] : null;
  const next = index >= 0 && index < files.length - 1 ? files[index + 1] : null;

  // panah kiri/kanan buat pindah file. buat video/audio ga diaktifin karena panahnya dipakai
  // buat seek sama plyr
  useEffect(() => {
    if (!file || kind === 'video' || kind === 'audio') return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' && prev) onNavigate(prev);
      if (event.key === 'ArrowRight' && next) onNavigate(next);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, kind, prev, next, onNavigate]);

  useEffect(() => {
    if (!media) return;
    // plyr nembak document waktu di-import, jadi harus diimport di browser doang
    let player: import('plyr').default | null = null;
    let cancelled = false;

    void import('plyr').then(({ default: Plyr }) => {
      if (cancelled) return;
      player = new Plyr(media);
    });

    return () => {
      cancelled = true;
      try {
        player?.destroy();
      } catch {
        // plyr bisa protes kalau react keburu nyabut nodenya, ga apa-apa
      }
    };
  }, [media]);

  // buka file lain: reset status loadingnya
  useEffect(() => {
    setState('loading');
  }, [file?.id]);

  const placeholder = file?.thumbnail ? thumbUrl(file, 800) : undefined;
  const showPlaceholder = state === 'loading' && Boolean(placeholder);

  return (
    <Modal
      opened={file !== null}
      onClose={onClose}
      size="xl"
      centered
      padding="md"
      title={
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" truncate maw={520}>
            {file?.name}
          </Text>
          {index >= 0 && files.length > 1 && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {index + 1} / {files.length}
            </Text>
          )}
        </Group>
      }
    >
      <div className={classes.previewWrap}>
        {file && kind === 'image' && (
        <div
          className={classes.stage}
          style={
            showPlaceholder
              ? {
                  backgroundImage: `url(${placeholder})`,
                  backgroundSize: 'contain',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }
              : undefined
          }
        >
          {state === 'loading' && !showPlaceholder && <Skeleton className={classes.stageFill} />}

          {state === 'error' ? (
            <Stack gap="xs" align="center">
              <Text size="sm" c="dimmed">
                could not load this image.
              </Text>
              <Anchor size="sm" href={downloadUrl(file)}>
                Download
              </Anchor>
            </Stack>
          ) : (
            <img
              className={classes.stageImage}
              style={{ opacity: state === 'ready' ? 1 : 0 }}
              src={previewUrl(file)}
              alt={file.name}
              draggable={false}
              onLoad={() => setState('ready')}
              onError={() => setState('error')}
            />
          )}
        </div>
      )}

      {file && kind === 'video' && (
        <div className={classes.player}>
          <video ref={setMedia} src={previewUrl(file)} poster={placeholder} controls playsInline />
        </div>
      )}

      {file && kind === 'audio' && <audio ref={setMedia} src={previewUrl(file)} controls />}

      {file && kind === 'zip' && <ZipList file={file} />}

      {file && kind === 'none' && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            no inline preview for {file.mimeType ?? 'this file type'}.
          </Text>
          <Group gap="md">
            {file.webViewLink && (
              <Anchor size="sm" href={file.webViewLink} target="_blank" rel="noreferrer">
                Open in Google Drive
              </Anchor>
            )}
            <Anchor size="sm" href={downloadUrl(file)}>
              Download
            </Anchor>
          </Group>
        </Stack>
      )}

        {files.length > 1 && (
          <>
            <ActionIcon
              className={`${classes.nav} ${classes.navLeft}`}
              size="lg"
              radius="xl"
              variant="filled"
              color="dark"
              aria-label="previous file"
              disabled={!prev}
              onClick={() => prev && onNavigate(prev)}
            >
              <IconChevronLeft size={22} />
            </ActionIcon>
            <ActionIcon
              className={`${classes.nav} ${classes.navRight}`}
              size="lg"
              radius="xl"
              variant="filled"
              color="dark"
              aria-label="next file"
              disabled={!next}
              onClick={() => next && onNavigate(next)}
            >
              <IconChevronRight size={22} />
            </ActionIcon>
          </>
        )}
      </div>
    </Modal>
  );
}
