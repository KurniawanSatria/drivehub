// smoke test jalur google drive: root, navigasi folder, validasi parameter.
// butuh dev server jalan dan minimal satu akun kesambung:
//   npm run dev            (terminal lain)
//   npm run check
import assert from 'node:assert/strict';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const FOLDER = 'application/vnd.google-apps.folder';
const EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

const get = async (path) => {
  const res = await fetch(`${APP}${path}`, { signal: AbortSignal.timeout(60000) });
  return { status: res.status, body: await res.json() };
};

// item internal google (script, prompt ai studio, form) ga punya byte, harusnya ga muncul
const isInternalJunk = (mimeType) =>
  mimeType !== FOLDER && mimeType.startsWith('application/vnd.google') && !EXPORTABLE.has(mimeType);

const root = await get('/api/files');
assert.equal(root.status, 200, `tidak bisa reach ${APP}, dev server-nya jalan?`);
assert.deepEqual(root.body.errors, [], 'root ga boleh error');

const folders = root.body.files.filter((file) => file.mimeType === FOLDER);
assert.ok(folders.length > 0, 'root harus punya folder');
assert.ok(
  folders.every((file) => !file.thumbnail),
  'folder ga boleh minta thumbnail',
);
const junk = root.body.files.filter((file) => isInternalJunk(file.mimeType));
assert.deepEqual(junk.map((file) => file.name), [], 'item internal google harus disembunyiin');
console.log(
  `root: ${root.body.total} item (${folders.length} folder, ${root.body.total - folders.length} file) -> ${folders
    .slice(0, 5)
    .map((file) => file.name)
    .join(', ')}`,
);

const target = folders[0];
const inside = await get(`/api/files?account=${target.accountId}&folder=${target.id}`);
assert.equal(inside.status, 200);
assert.deepEqual(inside.body.errors, [], `isi folder ${target.name} ga boleh error`);
assert.ok(
  inside.body.files.every((file) => file.accountId === target.accountId),
  'isi folder ga boleh nyampur akun lain',
);
assert.ok(!inside.body.files.some((file) => file.id === target.id), 'folder ga boleh isi dirinya sendiri');
assert.ok(
  inside.body.next === null || typeof inside.body.next === 'string',
  'next harus token halaman lanjutan atau null',
);
console.log(`folder "${target.name}": ${inside.body.total} item${inside.body.next ? ' (masih ada halaman lanjutan)' : ''}`);

if (inside.body.next) {
  const more = await get(
    `/api/files?account=${target.accountId}&folder=${target.id}&cursor=${inside.body.next}`,
  );
  assert.equal(more.status, 200);
  const firstPage = new Set(inside.body.files.map((file) => file.id));
  assert.ok(
    more.body.files.every((file) => !firstPage.has(file.id)),
    'halaman kedua ga boleh ngulang file halaman pertama',
  );
  console.log(`   halaman kedua: ${more.body.files.length} item, gaada duplikat`);
}

const account = root.body.files[0]?.accountId;
const attack = await get(`/api/files?account=${account}&folder=%27%20or%20trashed%3Dtrue%20or%20%27`);
assert.equal(attack.status, 400, 'folder id yang nyoba nyuntik query harus ditolak');
console.log(`folder id nyuntik -> ${attack.status}`);

assert.equal((await get('/api/files?account=ngawur')).status, 404, 'akun ngawur harus 404');
console.log('akun ngawur -> 404');

// --- unzip online: baca isi .zip + ambil satu entry tanpa unduh zip-nya
let zipFile = null;
for (const folder of [null, ...folders.slice(0, 5)]) {
  const page =
    folder === null ? root : await get(`/api/files?account=${folder.accountId}&folder=${folder.id}`);
  zipFile = page.body.files?.find((file) => /\.zip$/i.test(file.name));
  if (zipFile) break;
}

if (!zipFile) {
  console.log('\ngaada .zip di folder yang dicek, bagian unzip dilewatin');
} else {
  const listing = await get(`/api/zip?account=${zipFile.accountId}&id=${zipFile.id}`);
  assert.equal(listing.status, 200, `daftar isi zip harus 200: ${JSON.stringify(listing.body).slice(0, 200)}`);
  assert.ok(Array.isArray(listing.body.entries), 'harus ada array entries');
  assert.equal(typeof listing.body.truncated, 'boolean');

  const entry = listing.body.entries.find((item) => item.size > 0);
  if (!entry) {
    console.log(`\n"${zipFile.name}" kosong, tes entry dilewatin`);
  } else {
    const res = await fetch(
      `${APP}/api/zip?account=${zipFile.accountId}&id=${zipFile.id}&entry=${encodeURIComponent(entry.name)}`,
      { signal: AbortSignal.timeout(300000) },
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200, `entry harus 200, dapat ${res.status}`);
    assert.equal(bytes.length, entry.size, `isi entry harus ${entry.size} byte, dapat ${bytes.length}`);
    console.log(
      `\n"${zipFile.name}": ${listing.body.entries.length} entry${listing.body.truncated ? ' (kepotong)' : ''}, ambil "${entry.name.slice(0, 30)}" -> ${bytes.length} byte cocok`,
    );
  }

  const missing = await fetch(
    `${APP}/api/zip?account=${zipFile.accountId}&id=${zipFile.id}&entry=tidak-ada.txt`,
    { signal: AbortSignal.timeout(120000) },
  );
  assert.equal(missing.status, 502, 'entry yang gaada harus 502');
  console.log('entry yang gaada -> 502');
}

// --- pindah file (ngubah data, tapi bolak-balik: pindah, cek, balikin)
const accountId = root.body.files[0]?.accountId;
const moveSource = root.body.files.find((file) => file.mimeType !== FOLDER);
const moveTarget = root.body.files.find((file) => file.mimeType === FOLDER);

const transfer = async (payload) => {
  const res = await fetch(`${APP}/api/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300000),
  });
  return { status: res.status, body: await res.json() };
};

assert.equal((await transfer({ source: accountId, fileId: "' or trashed=true or '", target: accountId })).status, 400);
assert.equal((await transfer({ source: 'ngawur', fileId: 'abc', target: accountId })).status, 404);
assert.equal((await transfer({ source: accountId, fileId: 'abc' })).status, 400);
console.log('transfer: fileId nyuntik -> 400, akun ngawur -> 404, payload kurang -> 400');

if (!moveSource || !moveTarget) {
  console.log('gaada file/folder buat tes pindah, dilewatin');
} else {
  const intoFolder = await transfer({
    source: accountId,
    fileId: moveSource.id,
    target: accountId,
    folder: moveTarget.id,
  });

  if (intoFolder.status === 502 && /reconnect/i.test(intoFolder.body.error ?? '')) {
    console.log(`\nSKIP pindah file: ${intoFolder.body.error}`);
    console.log('-> klik Connect Google Drive lagi di sidebar buat semua akun, scope tulisnya belum ada');
  } else {
    assert.equal(intoFolder.status, 200, `pindah harus 200, dapatnya ${JSON.stringify(intoFolder.body)}`);
    assert.equal(intoFolder.body.mode, 'move', 'satu akun harusnya mode move, bukan copy');

    try {
      const inside = await get(`/api/files?account=${accountId}&folder=${moveTarget.id}`);
      assert.ok(
        inside.body.files.some((file) => file.id === moveSource.id),
        `"${moveSource.name}" harusnya udah ada di "${moveTarget.name}"`,
      );
      const outside = await get(`/api/files?account=${accountId}`);
      assert.ok(
        !outside.body.files.some((file) => file.id === moveSource.id),
        `"${moveSource.name}" harusnya udah ilang dari root`,
      );
      console.log(`\npindah "${moveSource.name.slice(0, 26)}" -> "${moveTarget.name}": 200, pindah beneran kepindah`);

      const movingBack = await transfer({ source: accountId, fileId: moveSource.id, target: accountId, folder: null });
      assert.equal(movingBack.status, 200, `balikin harus 200, dapatnya ${JSON.stringify(movingBack.body)}`);
      const restoredRoot = await get(`/api/files?account=${accountId}`);
      assert.ok(
        restoredRoot.body.files.some((file) => file.id === moveSource.id),
        `"${moveSource.name}" harusnya balik ke root`,
      );
      console.log(`balikin ke root: 200, "${moveSource.name.slice(0, 26)}" udah di tempatnya lagi`);
    } catch (err) {
      // jangan ninggalin file di folder yang salah kalau ada assert yang gagal
      await transfer({ source: accountId, fileId: moveSource.id, target: accountId, folder: null });
      throw err;
    }
  }
}

const noParam = await fetch(`${APP}/api/download`, { signal: AbortSignal.timeout(20000) });
assert.equal(noParam.status, 400);
console.log('download tanpa parameter -> 400');

// --- hapus ke trash: yang dites cuma validasinya, nge-trash file asli butuh file yang user pilih
const trash = async (payload) => {
  const res = await fetch(`${APP}/api/trash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  return { status: res.status, body: await res.json() };
};

assert.equal((await trash({ account: accountId, fileId: "' or trashed=true or '" })).status, 400);
assert.equal((await trash({ account: 'ngawur', fileId: 'abc' })).status, 404);
assert.equal((await trash({ account: accountId })).status, 400);
console.log('trash: fileId nyuntik -> 400, akun ngawur -> 404, payload kurang -> 400');

// --- gerbang lintas origin: halaman web lain ga boleh bisa ngubah data
const crossSite = (extra = {}) =>
  fetch(`${APP}/api/trash`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
      ...extra,
    },
    body: JSON.stringify({ account: accountId, fileId: 'ngawur' }),
    signal: AbortSignal.timeout(60000),
  });

assert.equal((await crossSite()).status, 403, 'POST lintas origin harus 403');
assert.equal(
  (await crossSite({ 'Content-Type': 'text/plain;charset=UTF-8' })).status,
  403,
  'simple request lintas origin (tanpa preflight) juga harus 403',
);
assert.equal((await crossSite({ 'Sec-Fetch-Site': 'same-site' })).status, 403, 'beda port pun harus 403');

// pakai id akun yang gaada biar salah-salah gaada akun yang beneran kehapus
const crossDelete = await fetch(`${APP}/api/accounts/ngawur`, {
  method: 'DELETE',
  headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
  signal: AbortSignal.timeout(30000),
});
assert.equal(crossDelete.status, 403, 'DELETE lintas origin harus 403');

assert.equal(
  (await crossSite({ Origin: `${APP}`, 'Sec-Fetch-Site': 'same-origin' })).status,
  502,
  'request yang beneran dari app harus tetep lewat',
);
console.log('gerbang lintas origin: cross-site + simple request + beda port + DELETE -> 403, same-origin lewat');

// --- storage: kuota dari about.get, breakdown per tipe dari enumerasi file
const storageRes = await fetch(`${APP}/api/storage?fresh=1`, { signal: AbortSignal.timeout(300000) });
assert.equal(storageRes.status, 200);
const storage = await storageRes.json();
assert.deepEqual(storage.errors, [], 'storage ga boleh error');
assert.ok(storage.accounts.length > 0, 'harus ada akun di laporan storage');
for (const row of storage.accounts) {
  assert.ok(row.limit === null || typeof row.limit === 'number', 'limit harus angka atau null');
  assert.ok(row.usage === null || typeof row.usage === 'number', 'usage harus angka atau null');
  assert.equal(typeof row.scanned, 'number');
  assert.ok(
    row.segments.every((segment) => segment.bytes > 0 && segment.count > 0),
    'segmen kosong harusnya udah dibuang',
  );
  const sorted = [...row.segments].sort((a, b) => b.bytes - a.bytes);
  assert.deepEqual(row.segments, sorted, 'segmen harus urut dari gede ke kecil');
  const typed = row.segments.reduce((sum, segment) => sum + segment.bytes, 0);
  console.log(
    `${row.label}: ${(row.usage ?? 0) / 1048576}MB used of ${row.limit ? (row.limit / 1073741824).toFixed(0) + 'GB' : 'unlimited'} | ${row.scanned} files, ${(typed / 1048576).toFixed(0)}MB terhitung -> ${row.segments.map((s) => s.key).join(', ') || 'kosong'}`,
  );
}

// --- preview media: cari gambar/audio di beberapa folder pertama, lalu tes Range
const wanted = { image: null, audio: null, video: null };
for (const folder of folders.slice(0, 5)) {
  const page = await get(`/api/files?account=${folder.accountId}&folder=${folder.id}`);
  for (const file of page.body.files) {
    const mime = file.mimeType ?? '';
    if (mime.startsWith('image/') && !wanted.image) wanted.image = file;
    if (mime.startsWith('audio/') && !wanted.audio) wanted.audio = file;
    if (mime.startsWith('video/') && !wanted.video) wanted.video = file;
  }
  if (wanted.image && wanted.audio && wanted.video) break;
}

const mediaUrl = (file, inline) =>
  `${APP}/api/download?account=${file.accountId}&id=${encodeURIComponent(file.id)}${inline ? '&inline=1' : ''}`;

for (const [kind, file] of Object.entries(wanted)) {
  if (!file) {
    console.log(`${kind}: gaada di folder yang dicek, tes dilewatin`);
    continue;
  }
  const full = await fetch(mediaUrl(file, true), { signal: AbortSignal.timeout(60000) });
  assert.equal(full.status, 200, `${kind} harus 200`);
  assert.equal(full.headers.get('content-type'), file.mimeType, `${kind} content-type harus asli`);
  assert.equal(full.headers.get('accept-ranges'), 'bytes', `${kind} harus nyalain accept-ranges`);
  assert.equal(full.headers.get('content-disposition'), null, 'mode inline ga boleh nyuruh download');
  await full.arrayBuffer();

  const partial = await fetch(mediaUrl(file, true), {
    headers: { Range: 'bytes=0-99' },
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(partial.status, 206, `${kind} harus 206 buat Range, bukan ${partial.status}`);
  assert.match(partial.headers.get('content-range') ?? '', /^bytes 0-99\//, `${kind} content-range salah`);
  assert.equal((await partial.arrayBuffer()).byteLength, 100, `${kind} harus balikin tepat 100 byte`);

  const attached = await fetch(mediaUrl(file, false), { signal: AbortSignal.timeout(60000) });
  assert.match(
    attached.headers.get('content-disposition') ?? '',
    /^attachment;/,
    'tanpa inline harus attachment biar keunduh',
  );
  await attached.body?.cancel();

  console.log(
    `${kind} "${file.name.slice(0, 28)}": 200 full, 206 range 100 byte, attachment kalau tanpa inline`,
  );
}

console.log('\nsemua check lolos');
