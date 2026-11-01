'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Paper,
  Select,
  Slider,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCheck,
  IconChevronRight,
  IconDotsVertical,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconFolderFilled,
  IconLayoutGrid,
  IconList,
  IconMovie,
  IconMusic,
  IconPhoto,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import classes from '../navbar.module.css';
import PreviewModal, { downloadUrl, thumbUrl } from '../preview';
import Shell from '../shell';
import { useConfirm } from '../confirm';
import { formatDate, formatSize, fileCategory } from '@/lib/format';
import type { AccountView, RemoteFile } from '@/lib/types';

type Errors = { accountId: string; label: string; message: string }[];
type View = 'grid' | 'list';
type SortField = 'name' | 'type' | 'modified' | 'size';
type SortDir = 'asc' | 'desc';
type Scope = { accountId: string | null; trail: { id: string; name: string }[] };

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'name', label: 'name' },
  { value: 'type', label: 'type' },
  { value: 'modified', label: 'modified' },
  { value: 'size', label: 'size' },
];

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
const ZIP_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz']);
const DOC_EXT = new Set(['txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'json']);

const isFolder = (file: RemoteFile) => file.mimeType === FOLDER_MIME;

// elemen yang punya aksinya sendiri: link, tombol, isian form, dan kartu yang bisa di-drag.
// narik kotak seleksi ga boleh mulai dari sini, biar klik, teks di search, dan drag file tetep jalan.
const isControl = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('a, button, input, textarea, select, [role="button"], [data-card]');

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

// ikon tipe file diwarnai kayak gdrive biar kebaca tanpa baca namanya
function typeColor(mimeType: string | null): string | undefined {
  if (!mimeType) return undefined;
  if (mimeType.includes('spreadsheet') || mimeType === 'text/csv') return 'var(--mantine-color-green-6)';
  if (mimeType.includes('presentation')) return 'var(--mantine-color-orange-6)';
  if (mimeType === 'application/pdf') return 'var(--mantine-color-red-6)';
  if (mimeType.includes('document')) return 'var(--mantine-color-blue-6)';
  if (mimeType.includes('form')) return 'var(--mantine-color-violet-6)';
  if (mimeType.startsWith('image/')) return 'var(--mantine-color-teal-6)';
  if (mimeType.startsWith('video/')) return 'var(--mantine-color-grape-6)';
  if (mimeType.startsWith('audio/')) return 'var(--mantine-color-yellow-6)';
  return undefined;
}

function FileIcon({ file, size = 34 }: { file: RemoteFile; size?: number }) {
  const ext = extensionOf(file.name);
  const props = { size, stroke: 1.2, color: typeColor(file.mimeType) };
  if (IMAGE_EXT.has(ext)) return <IconPhoto {...props} />;
  if (VIDEO_EXT.has(ext)) return <IconMovie {...props} />;
  if (AUDIO_EXT.has(ext)) return <IconMusic {...props} />;
  if (ZIP_EXT.has(ext)) return <IconFileZip {...props} />;
  if (ext === 'pdf') return <IconFileTypePdf {...props} />;
  if (DOC_EXT.has(ext)) return <IconFileText {...props} />;
  return <IconFile {...props} />;
}

// ukuran null (folder, file google) selalu di bawah, kebal arah sort
function compare(a: RemoteFile, b: RemoteFile, field: SortField, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (field === 'name') return sign * collator.compare(a.name, b.name);
  if (field === 'type') {
    // satu tipe nempel jadi satu, urutannya abjad kategori, dalemnya urut nama
    const byType = collator.compare(
      fileCategory(a.mimeType, a.name),
      fileCategory(b.mimeType, b.name),
    );
    return sign * (byType !== 0 ? byType : collator.compare(a.name, b.name));
  }
  if (field === 'modified') return sign * (a.modifiedAt ?? '').localeCompare(b.modifiedAt ?? '');
  if (a.size == null && b.size == null) return collator.compare(a.name, b.name);
  if (a.size == null) return 1;
  if (b.size == null) return -1;
  return sign * (a.size - b.size);
}

export default function FilesPage() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [errors, setErrors] = useState<Errors>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>({ accountId: null, trail: [] });
  const [view, setView] = useState<View>('grid');
  const [field, setField] = useState<SortField>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [next, setNext] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [cardSize, setCardSize] = useState(160);
  const [notice, setNotice] = useState<{ color: string; text: string } | null>(null);
  const [preview, setPreview] = useState<RemoteFile | null>(null);
  const [dragFiles, setDragFiles] = useState<RemoteFile[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // anchor + rect kartu disimpen dalam koordinat DOKUMEN (bukan layar), biar scroll ga bikin meleset
  const anchor = useRef<{ x: number; y: number; base: Set<string> } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const rects = useRef<{ key: string; left: number; top: number; right: number; bottom: number }[]>([]);
  const lastSelection = useRef<Set<string>>(new Set());
  const { confirm, dialog: confirmDialog } = useConfirm();

  // ukuran item kesimpen, jadi ga balik default tiap reload. dibaca di effect biar ga
  // beda sama hasil render server (hydration)
  useEffect(() => {
    const saved = Number(window.localStorage.getItem('drivehub.cardSize'));
    if (saved >= 90 && saved <= 320) setCardSize(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('drivehub.cardSize', String(cardSize));
  }, [cardSize]);

  const scopeQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (scope.accountId) {
      params.set('account', scope.accountId);
      const folder = scope.trail.at(-1)?.id;
      if (folder) params.set('folder', folder);
    }
    return params;
  }, [scope]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = scopeQuery().toString();
      const [accountsRes, filesRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch(`/api/files${suffix ? `?${suffix}` : ''}`),
      ]);
      const accountsData = await accountsRes.json();
      const filesData = await filesRes.json();
      setAccounts(accountsData.accounts ?? []);
      setFiles(filesData.files ?? []);
      setErrors(filesData.errors ?? []);
      setNext(filesData.next ?? null);
    } catch (err) {
      setErrors([{ accountId: '', label: 'app', message: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setLoading(false);
    }
  }, [scopeQuery]);

  // folder yang isinya lebih dari 1000: lanjut halaman berikutnya, ga ngeganti yang udah keload
  async function loadMore() {
    if (!next || moreLoading) return;
    setMoreLoading(true);
    try {
      const params = scopeQuery();
      params.set('cursor', next);
      const data = await (await fetch(`/api/files?${params}`)).json();
      const incoming = (data.files ?? []) as RemoteFile[];
      setFiles((prev) => {
        const seen = new Set(prev.map((file) => `${file.accountId}:${file.id}`));
        return [...prev, ...incoming.filter((file) => !seen.has(`${file.accountId}:${file.id}`))];
      });
      setErrors(data.errors ?? []);
      setNext(data.next ?? null);
    } catch (err) {
      setErrors([{ accountId: '', label: 'app', message: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setMoreLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const connected = params.get('connected');
    if (error) setNotice({ color: 'red', text: error });
    if (connected) setNotice({ color: 'green', text: `${connected} connected` });
    if (error || connected) window.history.replaceState(null, '', '/files');
  }, []);

  useEffect(() => {
    if (dragFiles.length === 0) return;

    // tanpa preventDefault di dragover, browser nampilin cursor "no-drop" di semua area yang
    // bukan target drop. satu listener di document bikin cursor-nya normal di mana-mana,
    // dan drop di tempat kosong cuma bersihin state.
    const allow = (event: DragEvent) => event.preventDefault();
    const reset = () => {
      setDragFiles([]);
      setOver(null);
    };

    document.addEventListener('dragover', allow);
    document.addEventListener('drop', reset);
    return () => {
      document.removeEventListener('dragover', allow);
      document.removeEventListener('drop', reset);
    };
  }, [dragFiles]);

  // enter/escape: escape ngebersihin pilihan
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // pindah folder = pilihan lama ga relevan lagi
  useEffect(() => {
    setSelected(new Set());
  }, [scope]);

  // kotaknya digambar langsung ke dom, bukan lewat state: setState tiap mousemove = satu
  // re-render seluruh halaman, itu yang bikin terasa berat
  const paintBox = (left: number, top: number, width: number, height: number) => {
    const node = boxRef.current;
    if (!node) return;
    node.style.display = 'block';
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
  };

  // tarik kotak di area kosong = milih banyak item, kayak gdrive.
  // koordinat dokumen, jadi bisa di-scroll sambil narik
  const recompute = useCallback(() => {
    const start = anchor.current;
    if (!start) return;

    const px = pointer.current.x + window.scrollX;
    const py = pointer.current.y + window.scrollY;

    const left = Math.min(start.x, px);
    const top = Math.min(start.y, py);
    const right = Math.max(start.x, px);
    const bottom = Math.max(start.y, py);

    paintBox(left - window.scrollX, top - window.scrollY, right - left, bottom - top);

    const next = new Set(start.base);
    for (const rect of rects.current) {
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) {
        next.add(rect.key);
      }
    }

    const before = lastSelection.current;
    if (next.size !== before.size || [...next].some((key) => !before.has(key))) {
      lastSelection.current = next;
      setSelected(next);
    }
  }, []);

  useEffect(() => {
    if (!selecting) return;

    const move = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      // satu hitungan per frame, bukan per event mousemove
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        recompute();
      });
    };

    // auto-scroll waktu kursor nyentuh tepi atas/bawah, biar bisa milih sampai bawah
    let auto = 0;
    const EDGE = 90;
    const MAX_STEP = 26;

    const tick = () => {
      const y = pointer.current.y;
      let delta = 0;
      if (y > 0 && y < EDGE) delta = -Math.ceil(((EDGE - y) / EDGE) * MAX_STEP);
      else if (y > window.innerHeight - EDGE) {
        delta = Math.ceil(((y - (window.innerHeight - EDGE)) / EDGE) * MAX_STEP);
      }
      if (delta !== 0) {
        window.scrollBy(0, delta);
        recompute();
      }
      auto = requestAnimationFrame(tick);
    };
    auto = requestAnimationFrame(tick);

    const up = () => {
      anchor.current = null;
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      if (boxRef.current) boxRef.current.style.display = 'none';
      rects.current = [];
      setSelecting(false);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
    // kalau mouse dilepas di luar window, mouseup ga pernah dateng, kotaknya bakal nyangkut
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
      cancelAnimationFrame(auto);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [selecting, recompute]);

  const keyOf = (file: RemoteFile) => `${file.accountId}:${file.id}`;

  const startMarquee = (event: React.MouseEvent) => {
    // tombol kiri atau kanan, dua-duanya boleh narik kotak (menu konteks browser dimatiin di area ini)
    if ((event.button !== 0 && event.button !== 2) || busy) return;
    // mulai dari area kosong, bukan dari kartu/teks/tombol yang punya aksi sendiri
    if (isControl(event.target)) return;

    const additive = event.ctrlKey || event.metaKey;
    const base = additive ? new Set(selected) : new Set<string>();
    anchor.current = {
      x: event.clientX + window.scrollX,
      y: event.clientY + window.scrollY,
      base,
    };
    pointer.current = { x: event.clientX, y: event.clientY };

    // posisi semua kartu diukur SEKALI di awal, dalam koordinat dokumen. sebelumnya ini jalan
    // tiap mousemove, dan getBoundingClientRect buat ratusan kartu maksa browser ngitung ulang layout
    rects.current = [...(areaRef.current?.querySelectorAll<HTMLElement>('[data-card]') ?? [])].map(
      (node) => {
        const rect = node.getBoundingClientRect();
        return {
          key: node.dataset.card ?? '',
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          right: rect.right + window.scrollX,
          bottom: rect.bottom + window.scrollY,
        };
      },
    );

    lastSelection.current = base;
    if (!additive) setSelected(base);
    paintBox(event.clientX, event.clientY, 0, 0);
    setSelecting(true);
  };

  const pick = (file: RemoteFile) => {
    const key = keyOf(file);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { folders, files: shown } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = files.filter((file) => !needle || file.name.toLowerCase().includes(needle));
    const sorter = (a: RemoteFile, b: RemoteFile) => compare(a, b, field, dir);
    return {
      folders: matched.filter(isFolder).sort(sorter),
      files: matched.filter((file) => !isFolder(file)).sort(sorter),
    };
  }, [files, query, field, dir]);

  const ordered = useMemo(() => [...folders, ...shown], [folders, shown]);
  const selectedFiles = useMemo(
    () => ordered.filter((file) => selected.has(`${file.accountId}:${file.id}`)),
    [ordered, selected],
  );
  const activeAccount = accounts.find((account) => account.id === scope.accountId);
  const inFolder = scope.trail.length > 0;
  const showAccount = scope.accountId === null;

  const markBroken = useCallback((file: RemoteFile) => {
    setBroken((prev) => new Set(prev).add(`${file.accountId}:${file.id}`));
  }, []);

  const enterFolder = (file: RemoteFile) => {
    setScope((prev) => ({
      accountId: prev.accountId ?? file.accountId,
      trail: [...prev.trail, { id: file.id, name: file.name }],
    }));
    setQuery('');
  };

  const goCrumb = (index: number) => {
    setScope((prev) => ({ accountId: prev.accountId, trail: prev.trail.slice(0, index + 1) }));
    setQuery('');
  };

  // sumbernya ada di folder yang lagi dilihat. root view = parent-nya root akun itu sendiri
  const sourceParent = inFolder ? scope.trail.at(-1)!.id : null;

  async function transfer(targetAccountId: string, targetFolderId: string | null, label: string) {
    const list = dragFiles;
    setOver(null);
    setDragFiles([]);
    if (list.length === 0 || busy) return;

    // yang udah ada di folder tujuan ga usah dikirim
    const todo = list.filter(
      (file) => !(file.accountId === targetAccountId && targetFolderId === sourceParent),
    );
    if (todo.length === 0) return;

    const crossing = todo.filter((file) => file.accountId !== targetAccountId).length;
    const single = todo.length === 1 ? todo[0] : null;
    const lines: string[] = [];
    if (single) lines.push(`"${single.name}"`);
    lines.push(`Destination: ${label}`);
    if (crossing > 0) {
      lines.push(
        crossing === 1
          ? '1 item goes to another account: it gets copied and the original goes to the trash.'
          : `${crossing} items go to another account: they get copied and the originals go to the trash.`,
      );
    }

    const proceed = await confirm({
      title: `Move ${todo.length} item${todo.length > 1 ? 's' : ''}?`,
      message: lines.join('\n\n'),
      confirmLabel: 'Move',
    });
    if (!proceed) return;

    setBusy(true);
    const failed: string[] = [];
    try {
      for (const [index, file] of todo.entries()) {
        setNotice({ color: 'blue', text: `moving ${index + 1}/${todo.length} · ${file.name}` });
        const res = await fetch('/api/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: file.accountId,
            fileId: file.id,
            target: targetAccountId,
            folder: targetFolderId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) failed.push(`${file.name}: ${data.error ?? res.status}`);
      }

      if (failed.length === 0) {
        setNotice({
          color: 'green',
          text: `${todo.length} item${todo.length > 1 ? 's' : ''} moved to ${label}`,
        });
        setSelected(new Set());
      } else {
        setNotice({
          color: 'red',
          text: `${todo.length - failed.length}/${todo.length} moved. failed -> ${failed.join(' | ')}`,
        });
      }
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setNotice({ color: 'red', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // draggable + target drop. key-nya dipakai buat nandain target mana yang lagi di-hover
  const dragProps = (file: RemoteFile) => ({
    draggable: !busy,
    'data-dragging': dragFiles.some((item) => item === file) || undefined,
    onDragStart: (event: React.DragEvent) => {
      // item yang lagi kepilih ikut kebawa semua, kayak gdrive
      const inSelection = selected.has(keyOf(file));
      const payload = inSelection ? ordered.filter((item) => selected.has(keyOf(item))) : [file];
      setDragFiles(payload);

      const caption = payload.length > 1 ? `${payload.length} items` : file.name;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', caption);

      // drag image default itu snapshot kartu, dan itu gepeng kalau elemennya punya transform
      // (kartu ini naik 2px waktu hover). jadi pakai label bersih yang kita bikin sendiri.
      const ghost = document.createElement('div');
      ghost.textContent = caption;
      ghost.style.cssText = [
        'position:fixed',
        'top:-100px',
        'left:-100px',
        'max-width:220px',
        'overflow:hidden',
        'white-space:nowrap',
        'text-overflow:ellipsis',
        'padding:6px 10px',
        'border-radius:6px',
        'background:#25262b',
        'color:#fff',
        'border:1px solid #5c5f66',
        'font:12px/1.4 system-ui,sans-serif',
      ].join(';');
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 16);
      window.setTimeout(() => ghost.remove(), 0);
    },
    onDragEnd: () => {
      setDragFiles([]);
      setOver(null);
    },
  });

  const dropProps = (key: string, onDrop: () => void) => ({
    'data-drop': over === key || undefined,
    onDragOver: (event: React.DragEvent) => {
      if (dragFiles.length === 0 || busy) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setOver(key);
    },
    onDragLeave: () => setOver((current) => (current === key ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      onDrop();
    },
  });

  async function trash(files: RemoteFile[]) {
    if (files.length === 0 || busy) return;

    const lines = [`"${files[0].name}"`];
    if (files.length > 1) lines.push(`and ${files.length - 1} more`);
    lines.push('Goes to the trash, not deleted. it can be restored from google drive for 30 days.');

    const proceed = await confirm({
      title: `Move ${files.length} item${files.length > 1 ? 's' : ''} to trash?`,
      message: lines.join('\n\n'),
      confirmLabel: 'Move to trash',
      danger: true,
    });
    if (!proceed) return;

    setBusy(true);
    const failed: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setNotice({ color: 'blue', text: `trashing ${index + 1}/${files.length} · ${file.name}` });
        const res = await fetch('/api/trash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: file.accountId, fileId: file.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) failed.push(`${file.name}: ${data.error ?? res.status}`);
      }

      if (failed.length === 0) {
        setNotice({
          color: 'green',
          text: `${files.length} item${files.length > 1 ? 's' : ''} moved to trash`,
        });
        setSelected(new Set());
      } else {
        setNotice({
          color: 'red',
          text: `${files.length - failed.length}/${files.length} trashed. failed -> ${failed.join(' | ')}`,
        });
      }
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setNotice({ color: 'red', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // kalau itemnya lagi kepilih, aksinya kena semua yang kepilih, kayak gdrive
  const actingOn = (file: RemoteFile) =>
    selected.has(keyOf(file)) ? ordered.filter((item) => selected.has(keyOf(item))) : [file];

  const isZip = (file: RemoteFile) => extensionOf(file.name) === 'zip';

  const itemMenu = (file: RemoteFile, size: 'sm' | 'md') => {
    const folder = isFolder(file);
    const targets = actingOn(file);
    return (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size={size} aria-label={`actions for ${file.name}`}>
            <IconDotsVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {file.webViewLink && (
            <Menu.Item
              component="a"
              href={file.webViewLink}
              target="_blank"
              rel="noreferrer"
              leftSection={<IconExternalLink size={14} />}
            >
              Open in Google Drive
            </Menu.Item>
          )}
          {isZip(file) && (
            <Menu.Item leftSection={<IconFileZip size={14} />} onClick={() => setPreview(file)}>
              See contents (unzip)
            </Menu.Item>
          )}
          {!folder && (
            <Menu.Item component="a" href={downloadUrl(file)} leftSection={<IconDownload size={14} />}>
              Download
            </Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => void trash(targets)}
          >
            Move to trash{targets.length > 1 ? ` (${targets.length})` : ''}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  };

  const folderTile = (folder: RemoteFile) => (
    <Group
      key={`${folder.accountId}:${folder.id}`}
      className={classes.tile}
      gap="xs"
      wrap="nowrap"
      data-card={`${folder.accountId}:${folder.id}`}
      data-selected={selected.has(`${folder.accountId}:${folder.id}`) || undefined}
      {...dragProps(folder)}
      {...dropProps(`folder:${folder.id}`, () => void transfer(folder.accountId, folder.id, folder.name))}
    >
      <UnstyledButton
        className={classes.tileHit}
        onClick={(event) => {
          // klik biasa = masuk folder (kayak sekarang), ctrl/cmd klik = milih doang
          if (event.ctrlKey || event.metaKey) pick(folder);
          else enterFolder(folder);
        }}
      >
        <IconFolderFilled size={18} />
        <Text size="sm" fw={500} truncate title={folder.name}>
          {folder.name}
        </Text>
      </UnstyledButton>
      {showAccount && (
        <Text size="xs" c="dimmed" visibleFrom="sm" truncate maw="45%" style={{ flexShrink: 0 }}>
          {folder.accountLabel.split('@')[0]}
        </Text>
      )}
      {itemMenu(folder, 'sm')}
    </Group>
  );

  const fileCard = (file: RemoteFile) => {
    const key = `${file.accountId}:${file.id}`;
    const showThumb = file.thumbnail && !broken.has(key);
    // di bawah 120px header (ikon + nama + tombol) ga muat, jadi kartunya thumbnail polos
    const compact = cardSize < 120;
    const iconSize = Math.min(64, Math.max(14, Math.round(cardSize * 0.4)));

    return (
      <Card
        key={key}
        className={classes.card}
        withBorder
        padding={0}
        radius={compact ? 'sm' : 'md'}
        data-card={key}
        data-selected={selected.has(key) || undefined}
        title={compact ? `${file.name}\n${formatSize(file.size)} · ${file.accountLabel}` : undefined}
        {...dragProps(file)}
      >
        {!compact && (
          <Group gap="xs" wrap="nowrap" p="xs" className={classes.cardHead}>
            <FileIcon file={file} size={18} />
            <UnstyledButton
              style={{ flex: 1, minWidth: 0 }}
              aria-label={`preview ${file.name}`}
              onClick={(event) => {
                // klik biasa = buka preview, ctrl/cmd klik = milih doang
                if (event.ctrlKey || event.metaKey) pick(file);
                else setPreview(file);
              }}
            >
              <Text size="sm" truncate title={file.name} className={classes.selectable}>
                {file.name}
              </Text>
            </UnstyledButton>
            {showAccount && (
              <Text size="xs" c="dimmed" visibleFrom="sm">
                {file.accountLabel.split('@')[0]}
              </Text>
            )}
            {itemMenu(file, 'sm')}
          </Group>
        )}
        <Card.Section>
          <UnstyledButton
            className={classes.previewHit}
            aria-label={`preview ${file.name}`}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey) pick(file);
              else setPreview(file);
            }}
          >
            <Center className={classes.previewStage} bg="var(--mantine-color-default-hover)">
              {showThumb ? (
                <img
                  src={thumbUrl(file, cardSize * 2)}
                  alt={file.name}
                  loading="lazy"
                  draggable={false}
                  onError={() => markBroken(file)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <FileIcon file={file} size={iconSize} />
              )}
            </Center>
          </UnstyledButton>
        </Card.Section>
      </Card>
    );
  };

  return (
    <Shell
      accounts={accounts}
      activeAccountId={scope.accountId}
      onSelectAccount={(id) => setScope({ accountId: id, trail: [] })}
      onChanged={() => setRefreshKey((key) => key + 1)}
      dropAccountId={over?.startsWith('account:') ? over.slice('account:'.length) : null}
      onAccountDragOver={(id) => setOver(id ? `account:${id}` : null)}
      onAccountDrop={(id) => {
        const account = accounts.find((item) => item.id === id);
        void transfer(id, null, account ? `${account.label} root` : 'that account');
      }}
      actions={
        <>
          <Tooltip label="grid view">
            <ActionIcon
              variant={view === 'grid' ? 'filled' : 'default'}
              aria-label="grid view"
              onClick={() => setView('grid')}
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="list view">
            <ActionIcon
              variant={view === 'list' ? 'filled' : 'default'}
              aria-label="list view"
              onClick={() => setView('list')}
            >
              <IconList size={16} />
            </ActionIcon>
          </Tooltip>
        </>
      }
    >
      <Stack
        ref={areaRef}
        gap="md"
        className={classes.selectArea}
        style={{ '--card-min': `${cardSize}px` } as React.CSSProperties}
        onMouseDown={startMarquee}
        // di area kosong, menu konteks browser dimatiin biar tombol kanan bisa dipakai narik kotak
        onContextMenu={(event) => {
          if (!isControl(event.target)) event.preventDefault();
        }}
      >
        {notice && (
          <Alert color={notice.color} withCloseButton onClose={() => setNotice(null)} className={classes.selectable}>
            {notice.text}
          </Alert>
        )}

        {errors.map((err) => (
          <Alert key={err.accountId} color="red" title={`failed to read ${err.label}`} className={classes.selectable}>
            {err.message}
          </Alert>
        ))}

        {accounts.length === 0 && !loading && (
          <Alert color="blue" title="No accounts connected yet">
            click <b>Connect Google Drive</b> on the left to link an account. you can add more than one and switch
            between them from the sidebar.
          </Alert>
        )}

        <Breadcrumbs separator={<IconChevronRight size={14} />} separatorMargin={6}>
          <Anchor size="sm" component="button" onClick={() => setScope({ accountId: null, trail: [] })}>
            All accounts
          </Anchor>
          {activeAccount && (
            <Anchor
              size="sm"
              component="button"
              className={classes.crumb}
              {...dropProps('crumb:root', () => void transfer(activeAccount.id, null, `${activeAccount.label} root`))}
              onClick={() => setScope({ accountId: activeAccount.id, trail: [] })}
            >
              {activeAccount.label.split('@')[0]}
            </Anchor>
          )}
          {scope.trail.map((step, index) => (
            <Anchor
              key={step.id}
              size="sm"
              component="button"
              className={classes.crumb}
              {...dropProps(`crumb:${step.id}`, () =>
                void transfer(scope.accountId!, step.id, step.name),
              )}
              onClick={() => goCrumb(index)}
            >
              {step.name}
            </Anchor>
          ))}
        </Breadcrumbs>

        <Group gap="sm" wrap="nowrap">
          <TextInput
            leftSection={<IconSearch size={15} />}
            placeholder={inFolder ? 'search in this folder' : 'search files'}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Select
            aria-label="sort by"
            data={SORT_FIELDS}
            value={field}
            onChange={(value) => setField((value as SortField) ?? 'name')}
            allowDeselect={false}
            w={130}
          />
          <Tooltip label={dir === 'asc' ? 'ascending' : 'descending'}>
            <ActionIcon
              variant="default"
              aria-label="toggle sort direction"
              onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}
            >
              {dir === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />}
            </ActionIcon>
          </Tooltip>          <Slider
            aria-label="item size"
            value={cardSize}
            onChange={setCardSize}
            min={90}
            max={320}
            step={10}
            w={110}
            label={(value) => `${value}px`}
            visibleFrom="sm"
          />
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {ordered.length} items
          </Text>
        </Group>

          {selected.size > 0 && (
            <Paper className={classes.selectionBar} p="xs" radius="md">
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  {selected.size} selected
                </Text>
                <Tooltip label="select everything on screen">
                  <ActionIcon
                    variant="subtle"
                    aria-label="select all shown"
                    onClick={() => setSelected(new Set(ordered.map(keyOf)))}
                  >
                    <IconCheck size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="move to trash">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="move selection to trash"
                    onClick={() => void trash(selectedFiles)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="clear selection">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="clear selection"
                    onClick={() => setSelected(new Set())}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Tooltip>
                <Text size="xs" c="dimmed">
                  drag any of them onto a folder or an account to move
                </Text>
              </Group>
            </Paper>
          )}

        {loading ? (
          <Center h={200}>
            <Loader />
          </Center>
        ) : view === 'grid' ? (
          <Stack gap="lg">
            {folders.length > 0 && (
              <div className={classes.tileGrid}>
                {folders.map(folderTile)}
              </div>
            )}
            {shown.length > 0 && (
              <div className={classes.cardGrid}>
                {shown.map(fileCard)}
              </div>
            )}
            {ordered.length === 0 && (
              <Text size="sm" c="dimmed" py="md">
                {inFolder ? 'this folder is empty' : 'no files'}
              </Text>
            )}
          </Stack>
        ) : (
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>name</Table.Th>
                <Table.Th>account</Table.Th>
                <Table.Th>size</Table.Th>
                <Table.Th>modified</Table.Th>
                <Table.Th aria-label="actions" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ordered.map((file) => (
                <Table.Tr
                  key={`${file.accountId}:${file.id}`}
                  data-card={`${file.accountId}:${file.id}`}
                  className={
                    selected.has(`${file.accountId}:${file.id}`) ? classes.rowSelected : undefined
                  }
                  {...dragProps(file)}
                  {...(isFolder(file)
                    ? dropProps(`folder:${file.id}`, () => void transfer(file.accountId, file.id, file.name))
                    : {})}
                >
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      {isFolder(file) ? <IconFolderFilled size={18} /> : <FileIcon file={file} size={18} />}
                      {isFolder(file) ? (
                        <Anchor
                          size="sm"
                          component="button"
                          fw={500}
                          truncate
                          maw={420}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (event.ctrlKey || event.metaKey) pick(file);
                            else enterFolder(file);
                          }}
                        >
                          {file.name}
                        </Anchor>
                      ) : (
                        <UnstyledButton
                          maw={420}
                          aria-label={`preview ${file.name}`}
                          onClick={(event) => {
                            if (event.ctrlKey || event.metaKey) pick(file);
                            else setPreview(file);
                          }}
                        >
                          <Text size="sm" truncate className={classes.selectable}>
                            {file.name}
                          </Text>
                        </UnstyledButton>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{file.accountLabel}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{isFolder(file) ? '-' : formatSize(file.size)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{isFolder(file) ? '-' : formatDate(file.modifiedAt)}</Text>
                  </Table.Td>
                  <Table.Td>{itemMenu(file, 'md')}</Table.Td>
                </Table.Tr>
              ))}
              {ordered.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text size="sm" c="dimmed" ta="center" py="md">
                      {inFolder ? 'this folder is empty' : 'no files'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        )}

        <div ref={boxRef} className={classes.box} />

        {next && (
          <Group justify="center">
            <Button variant="light" loading={moreLoading} onClick={() => void loadMore()}>
              Load more ({ordered.length} shown)
            </Button>
          </Group>
        )}
      </Stack>

      <PreviewModal
        file={preview}
        files={shown}
        onNavigate={setPreview}
        onClose={() => setPreview(null)}
      />
      {confirmDialog}
    </Shell>
  );
}
