import { Readable } from 'node:stream';
import { RandomAccessReader, fromRandomAccessReader, type Entry, type ZipFile } from 'yauzl';
import { readRange } from './gdrive';
import type { Account } from './types';

export type ZipEntryInfo = { name: string; size: number; compressedSize: number };

// yauzl minta random access reader, jadi byte-nya diambil per potong lewat HTTP Range.
// 1 chunk = 256KB: cukup gede biar ga boros request, cukup kecil biar ga sia-sia di baris terakhir
const CHUNK = 256 * 1024;
// yauzl baca central directory entry-per-entry, dan tiap baca cuma puluhan byte. kalau tiap baca
// jadi 1 request sendiri, zip dengan ribuan entry bakal butuh ribuan request (zip 1.5GB takeout
// sempat timeout 5 menit gara-gara ini). jadi baca kecil dilayani dari window yang di-cache.
const WINDOW = 1024 * 1024;

class DriveReader extends RandomAccessReader {
  private cache: { start: number; end: number; data: Buffer } | null = null;

  constructor(
    private readonly account: Account,
    private readonly fileId: string,
    private readonly totalSize: number,
  ) {
    super();
  }

  // end-nya eksklusif, sama kayak createReadStream-nya yauzl
  _readStreamForRange(start: number, end: number): Readable {
    if (end - start <= WINDOW) {
      return Readable.from(this.smallRange(start, end));
    }
    return Readable.from(this.largeRange(start, end));
  }

  private async *smallRange(start: number, end: number): AsyncGenerator<Buffer> {
    const cached = this.cache;
    if (!cached || start < cached.start || end > cached.end) {
      const windowEnd = Math.min(start + WINDOW, this.totalSize);
      this.cache = {
        start,
        end: windowEnd,
        data: await readRange(this.account, this.fileId, start, windowEnd - 1),
      };
    }

    const hit = this.cache!;
    yield hit.data.subarray(start - hit.start, end - hit.start);
  }

  private async *largeRange(start: number, end: number): AsyncGenerator<Buffer> {
    let position = start;
    while (position < end) {
      const last = Math.min(position + CHUNK - 1, end - 1);
      yield await readRange(this.account, this.fileId, position, last);
      position = last + 1;
    }
  }

  close(callback: (err: Error | null) => void): void {
    this.cache = null;
    callback(null);
  }
}

class BufferReader extends RandomAccessReader {
  constructor(private readonly data: Buffer) {
    super();
  }

  _readStreamForRange(start: number, end: number): Readable {
    return Readable.from([this.data.subarray(start, end)]);
  }

  close(callback: (err: Error | null) => void): void {
    callback(null);
  }
}

/** baca potongan byte dari drive. cuma bagian yang diminta yauzl yang beneran diunduh */
export function driveReader(account: Account, fileId: string, totalSize: number): RandomAccessReader {
  return new DriveReader(account, fileId, totalSize);
}

/** dari byte yang udah di memori. dipakai tes lokal tanpa nyentuh drive */
export function bufferReader(data: Buffer): RandomAccessReader {
  return new BufferReader(data);
}

function open(reader: RandomAccessReader, size: number): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromRandomAccessReader(reader, size, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) reject(err ?? new Error('zip-nya gagal dibuka'));
      else resolve(zipfile);
    });
  });
}

const isDirectory = (entry: Entry) => entry.fileName.endsWith('/');

// shortcut: daftar entry dibatasi biar zip ribuan file ga ngebanjir ui, sisanya ditandain truncated
export async function listZipEntries(
  reader: RandomAccessReader,
  size: number,
  max = 500,
): Promise<{ entries: ZipEntryInfo[]; truncated: boolean }> {
  const zip = await open(reader, size);

  return new Promise((resolve, reject) => {
    const entries: ZipEntryInfo[] = [];

    zip.on('error', reject);
    zip.on('end', () => resolve({ entries, truncated: false }));
    zip.on('entry', (entry) => {
      if (!isDirectory(entry)) {
        entries.push({
          name: entry.fileName,
          size: entry.uncompressedSize,
          compressedSize: entry.compressedSize,
        });
      }

      if (entries.length >= max) {
        zip.close();
        resolve({ entries, truncated: true });
        return;
      }
      zip.readEntry();
    });

    zip.readEntry();
  });
}

/** balikin stream isi satu entry. zipfile-nya dibiarin kebuka sampe stream-nya abis */
export async function openZipEntry(
  reader: RandomAccessReader,
  size: number,
  name: string,
): Promise<Readable> {
  const zip = await open(reader, size);

  return new Promise((resolve, reject) => {
    let found = false;

    zip.on('error', reject);
    zip.on('end', () => {
      if (!found) reject(new Error(`"${name}" gaada di dalam zip`));
    });
    zip.on('entry', (entry) => {
      if (entry.fileName !== name || isDirectory(entry)) {
        zip.readEntry();
        return;
      }
      found = true;
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) reject(err ?? new Error(`gagal baca "${name}"`));
        else resolve(stream);
      });
    });

    zip.readEntry();
  });
}
