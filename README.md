# DriveHUB

one file browser for several google drive accounts at once.

connect an account and its folders and files show up next to the others. you can browse, search,
sort, preview, download, move files between accounts, and send things to trash. each account keeps
its own tree, because the google api has no cross-account move.

## pages

- `/` dashboard: stat row (accounts, total used, files counted, biggest type), one card per account
  with quota plus usage per file type, and a table of the **largest files** (top 10 per account, with
  a download button). the largest numbers come from the same enumeration as the usage split, so they
  cost no extra request.
- `/files` browser: folders + files, search, sort, preview, download, move, trash.

## run

```bash
npm install
cp .env.example .env.local   # fill in google credentials
npm run dev                  # http://localhost:3000
```

## google drive setup

1. open [google cloud console](https://console.cloud.google.com/) and create a project.
2. **apis & services > library** -> enable **google drive api**.
3. **apis & services > oauth consent screen** -> type **external**, fill in app name and email.
   under **test users**, add the google accounts you want to connect. testing mode is enough, no
   google verification needed.
4. **apis & services > credentials** -> **create credentials > oauth client id** -> type
   **web application**. under **authorized redirect uris**, add:

   ```
   http://localhost:3000/api/oauth/google/callback
   ```

5. copy the client id and client secret into `.env.local`.
6. click **Connect Google Drive** in the sidebar. for a second account, click again and pick a
   different google account (`prompt=select_account` forces the picker).

> **the scope is `drive` (read + write + delete)**, not `drive.readonly`, because moving files needs
> write access. the app can therefore change or delete anything in a connected account. an account
> still holding a readonly token gets "read-only permission" errors on move: click Connect once for
> that account to upgrade it.

## moving files (drag & drop)

- drop a file or folder on a **folder tile** (or the folder name in list view) to move it in. within
  one account this is a real move (`files.update` swaps the parent): the file keeps its id, shares,
  and owner, and nothing is copied or deleted.
- drop on an **account in the sidebar** to move it across accounts. the google api has no
  cross-account move, so the bytes are copied to the target account and the original goes to
  **trash** (recoverable). google docs/sheets/slides are exported first (docx/xlsx/pptx), because
  their bytes only exist inside google.
- drop on a **breadcrumb** to move it up to that folder, or to the account root.
- every drop asks for confirmation, then shows a blue notice while it runs.
- **selecting many**: drag a box over empty space (marquee), `ctrl`/`cmd` + click to add or remove a
  single item, `esc` to clear. the empty space is the whole content panel under the toolbar, so you
  can start above the first item, between cards, or under the last row. left and right mouse button
  both work. you can scroll while dragging (a cursor near the top or bottom edge scrolls the page),
  and the box sticks to the content, not to the screen.
  a selection brings up a sticky **action bar**: count, `select all` (everything on screen), `move to
  trash`, `clear`. dragging one of the selected items carries all of them, and they move one by one
  with `moving 3/5` progress. a failure does not stop the rest, and the notice reports it
  (`2/5 moved. failed -> ...`).
- **downloading many at once is missing**: chrome asks for the "download multiple files" permission
  and blocks it easily, so the plan is to zip on the server with `archiver` (not installed yet).
- folders cannot move across accounts (no recursion), and items that only live inside google (forms,
  apps script projects, ai studio prompts) are rejected with a clear message.

## unzip online

click a `.zip` in grid or list view and the modal lists the **archive contents**: name and size per
entry, each row with a download button that **pulls one entry without downloading the whole zip**.

- how: a zip central directory sits at the **end** of the file, so reading it needs only HTTP Range
  requests. a 1.5GB zip lists in **~1.7s** (measured), no full download. entries are read in 256KB
  chunks.
- `lib/zip.ts` wraps [yauzl](https://github.com/thejoshwolfe/yauzl) with its own random access
  reader. yauzl walks the central directory entry by entry (tens of bytes per read), so small reads
  are served from a 1MB window cache. without it, a takeout zip with thousands of entries became
  thousands of http requests and timed out at 5 minutes.
- limits: `.zip` only (rar/7z need unrar), the list stops at the first 500 entries (flagged
  `truncated`), and there is no "extract all to drive".

## notes

- **quota** on the dashboard comes from `about.get` (google's official number, includes gmail,
  photos, and trash). **usage per type** is different: it enumerates the files owned by that account,
  one page of 1000 files per request, 10 pages max. an account above 10k files is flagged `partial`
  and the ui says "first 10k counted". the result is cached on the server for 5 minutes, and the sync
  button busts that cache.
- **sync button in the header** (top right, on every page) refreshes the current view **and** reruns
  the enumeration for all accounts. hovering it shows the last sync time.
- **account emails are masked** to `s*****@gmail.com` in everything sent to the browser: sidebar,
  card headers, tables, folder tiles, dashboard, largest files, error messages, and "connected"
  notices. masking happens on the server (`maskEmail` in `lib/format.ts`) at the api boundary, not at
  each render site, so no screen can forget it. the raw address only lives in `.data/accounts.json`,
  which reconnect matching still needs.
- **routes that change data check their origin** (`POST /api/transfer`, `POST /api/trash`,
  `DELETE /api/accounts/[id]`): `Sec-Fetch-Site` must be `same-origin` or `none`, and `Origin` must
  match. without that, any web page open in the browser could hit `http://localhost:3000/api/trash`
  and trash files. the attacker cannot read the response, but the action still runs. POST also
  requires `content-type: application/json` as a second layer, because a cross-origin simple request
  cannot set that header without a preflight. non-browser clients (curl, scripts) that send no headers
  stay allowed.
- accounts and tokens live in `.data/accounts.json` (mode `0600` on linux/mac). refresh tokens are
  stored in plaintext: do not commit `.data`, and do not expose this app to the internet.
- only files owned by the connected account (`'me' in owners`) are listed. files merely shared with
  it, shared drive files, and google-internal items (apps script projects, ai studio prompts) stay
  hidden, because there are no bytes to download.
- folder navigation: the root lists folders + files, click a folder to enter, breadcrumbs on top to
  go back. folders always sit in the top block, sorted by name; files follow the chosen sort.
- **1000 items per folder per page**, with a `Load more` button that follows `nextPageToken` into the
  next page.
- google docs/sheets/slides are exported to docx/xlsx/pptx on download.
- the default grid view follows drive: folders are thin rows on top (folder icon + name), files are
  cards with a colored type-icon header, a name, and a three-dot menu, with the preview below. the
  menu holds **Open in Google Drive** (folders and files), **Download** (files only, folders have no
  bytes), and **Move to trash** (google drive trash, recoverable for 30 days, not a permanent
  delete). with several items selected, a menu action applies to all of them.
- thumbnails come from `thumbnailLink` and the browser caches them for an hour. without one, the card
  falls back to a type icon. `/api/thumb?size=` overrides google's size suffix, so cards ask for
  `cardSize * 2`.
- sort model follows drive: pick a field (name / type / modified / size) plus an ascending or
  descending toggle. sorting by `type` groups by category (image, video, archive, ...) and sorts by
  name inside each group, using the same category function as the dashboard (`lib/format.ts`).
- click a name or a card body to preview. images use a full resolution `<img>`, video and audio use
  [plyr](https://github.com/sampotts/plyr), other types (zip, docs) get a drive link plus download.
  while a large image is still loading, the skeleton is filled with the cached thumbnail instead of
  an empty grey box.
- `/api/download` forwards the `Range` header to google, so video can be seeked without waiting for
  the whole file. add `?inline=1` to drop `content-disposition` (used by `<img>`/`<video>`).
- **plyr 3.8.5 on npm is deprecated** (security updates only, they point at video.js 10). it still
  works, but the swap options are native `<video controls>` (zero dependencies) or video.js. the
  player is imported dynamically in `app/preview.tsx` because plyr touches `document` at import time,
  which alone breaks `next build`.

## check

```bash
npm run dev     # terminal 1
npm run check   # terminal 2
```

smoke test over the drive paths: list the root, enter a folder, page through a folder without
duplicates, reject an injected folder id and an unknown account, list a zip and reject a missing
entry, validate the transfer and trash payloads, move a file for real and move it back, validate
download params, check the cross-origin gate, read per-account storage, and pull media with a `Range`
header. needs at least one connected account. use `APP_URL=http://localhost:3001 npm run check` when
the port differs.
