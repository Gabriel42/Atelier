#!/usr/bin/env node
// Library visualizer: a page to browse the asset library (images, sounds, fonts,
// 3D models), with search, filters and each pack's licence.
//
//   node library.mjs <library folder>            build the page, then open it in the browser
//   node library.mjs <library folder> --build    build the page only (library/index.html)
//   node library.mjs <library folder> --port 5000
//
// The folder can be the library itself or the folder that holds it (Atelier).
// The page is written to <library>/index.html and stays there: git ignores it,
// because it shows the assets. Opened through this tool (a small local server on
// this computer only), 3D models get a live preview; opened as a plain file, the
// rest works but models show no preview (browsers block that for local files)
// and tags cannot be changed. Tags Gabriel puts on assets are saved in <library>/tags.json.
// No dependencies; needs Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
  sound: ['ogg', 'wav', 'mp3'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
  model: ['glb', 'gltf', 'obj', 'fbx', 'dae', 'stl', '3ds'],
};
const TYPE_OF = {};
for (const [t, exts] of Object.entries(TYPES)) for (const e of exts) TYPE_OF[e] = t;

/** The best format to preview, first one wins. */
const PREFER = ['glb', 'gltf', 'obj', 'fbx', 'dae', 'stl', '3ds', 'ogg', 'mp3', 'wav'];

/** Folders that are never scanned. */
const SKIP_DIRS = new Set(['downloaded', '.git', '.obsidian', '.import', '.godot', 'node_modules']);

/** A folder named after a format ("GLTF format", "ogg") only sorts copies of the same asset. */
const FORMAT_DIR = /^(dae|fbx|gltf|glb|obj|stl|3ds|ogg|wav|mp3)( format)?$/i;

// ---------- arguments ----------

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const portArg = args.indexOf('--port');
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
if (!target) {
  console.log('Usage: node library.mjs <library folder> [--build] [--port 4321]');
  process.exit(1);
}
let root = path.resolve(target);
if (!fs.existsSync(path.join(root, 'packs')) && fs.existsSync(path.join(root, 'library'))) root = path.join(root, 'library');
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.log(`No library found at ${root}`);
  process.exit(1);
}

// ---------- scan ----------

/** Every file under dir, as paths relative to root with forward slashes. */
function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name.toLowerCase())) walk(full, out);
    } else if (e.isFile()) {
      out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

/** Width and height read from an image file's header (PNG, GIF, BMP), or null. */
function imageSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(30);
    fs.readSync(fd, b, 0, 30, 0);
    if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
    if (b.toString('ascii', 0, 2) === 'BM') return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
  } catch { /* unreadable: no size */ } finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}

/** Reads a licence note ("Key: value" lines) into what the page shows. */
function readLicence(file) {
  const text = fs.readFileSync(file, 'utf8');
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const lic = fields.licence || fields.license || '';
  let status = 'free';
  if (/not read|to do|check/i.test(lic + ' ' + (fields['to do'] || ''))) status = 'check';
  else if (/with credit|credit needed|credit required|attribution required|\bCC BY\b/i.test(lic) && !/no credit/i.test(lic)) status = 'credit';
  return {
    title: fields.pack || '',
    author: fields.author || '',
    licence: lic,
    creditLine: (fields['credit line'] || '').replace(/^"|"$/g, ''),
    limits: fields.limits || '',
    note: [fields.note, fields['to do']].filter(Boolean).join(' '),
    source: fields.source || '',
    status,
  };
}

function scan() {
  const started = Date.now();
  const files = walk(root);
  const fileSet = new Set(files);

  // Packs: each folder in packs/, plus each top folder of loose assets (sprites/, audio-sfx/...).
  const packs = [];
  const packOf = {};
  function addPack(key, name, licenceFile) {
    const info = licenceFile && fileSet.has(licenceFile) ? readLicence(path.join(root, licenceFile)) : null;
    const p = {
      key, name, loose: !key.startsWith('packs/'),
      title: info?.title || name, author: info?.author || '', licence: info?.licence || '',
      creditLine: info?.creditLine || '', limits: info?.limits || '', note: info?.note || '',
      source: info?.source || '', licenceFile: info ? licenceFile : '',
      status: info ? info.status : 'none',
      count: 0,
    };
    if (!info && p.loose) p.status = 'own';
    packOf[key] = packs.length;
    packs.push(p);
  }
  if (fs.existsSync(path.join(root, 'packs'))) {
    for (const e of fs.readdirSync(path.join(root, 'packs'), { withFileTypes: true })) {
      if (e.isDirectory()) addPack(`packs/${e.name}`, e.name, `packs/${e.name}.license.txt`);
    }
  }

  // Group copies of one asset (same name, same type, only the format or format folder differs).
  const groups = new Map();
  const dirs = [];
  const dirIndex = new Map();
  const dirId = d => { if (!dirIndex.has(d)) { dirIndex.set(d, dirs.length); dirs.push(d); } return dirIndex.get(d); };
  let licenceNotes = 0;

  for (const rel of files) {
    const dot = rel.lastIndexOf('.');
    const ext = dot > rel.lastIndexOf('/') ? rel.slice(dot + 1).toLowerCase() : '';
    const type = TYPE_OF[ext];
    if (!type) { if (rel.endsWith('.license.txt')) licenceNotes++; continue; }
    const parts = rel.split('/');
    let packKey;
    if (parts[0] === 'packs' && parts.length > 2) packKey = `packs/${parts[1]}`;
    else if (parts.length > 1) packKey = parts[0];
    else continue; // a file at the library's top: not an asset
    if (!(packKey in packOf)) addPack(packKey, packKey, null);
    const name = parts[parts.length - 1].slice(0, dot - rel.lastIndexOf('/') - 1);
    const dir = parts.slice(0, -1).join('/');
    const groupDir = parts.slice(0, -1).filter(s => !FORMAT_DIR.test(s)).join('/');
    const key = `${type}|${groupDir}|${name.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { type, pack: packOf[packKey], name, groupDir, formats: [], licence: '' };
      groups.set(key, g);
    }
    g.formats.push({ ext, dir });
    // A loose asset's own licence note: <file>.license.txt or <name>.license.txt next to it.
    for (const cand of [`${rel}.license.txt`, `${dir}/${name}.license.txt`]) {
      if (fileSet.has(cand)) g.licence = cand;
    }
  }

  const items = [];
  for (const g of groups.values()) {
    g.formats.sort((a, b) => PREFER.indexOf(a.ext) - PREFER.indexOf(b.ext) || (TYPES[g.type].indexOf(a.ext) - TYPES[g.type].indexOf(b.ext)));
    const main = g.formats[0];
    const mainPath = path.join(root, `${main.dir}/${g.name}.${main.ext}`);
    let size = 0;
    try { size = fs.statSync(mainPath).size; } catch { /* gone */ }
    const wh = g.type === 'image' ? imageSize(mainPath) : null;
    packs[g.pack].count++;
    // [type, pack, name, [[ext, dir], ...], bytes, width, height, licence note]
    items.push([g.type, g.pack, g.name, g.formats.map(f => [f.ext, dirId(f.dir)]), size, wh?.[0] || 0, wh?.[1] || 0, g.licence]);
  }
  items.sort((a, b) => a[1] - b[1] || dirs[a[3][0][1]].localeCompare(dirs[b[3][0][1]]) || a[2].localeCompare(b[2], undefined, { numeric: true }));

  // Licence notes of loose assets, read once each.
  const notes = {};
  for (const it of items) if (it[7] && !(it[7] in notes)) notes[it[7]] = readLicence(path.join(root, it[7]));

  return { packs: packs.filter(p => p.count), allPacks: packs, dirs, items, notes, files: files.length, ms: Date.now() - started };
}

// ---------- page ----------

function build() {
  const data = scan();
  // Drop packs with no assets and renumber.
  const keep = data.allPacks.map((p, i) => [p, i]).filter(([p]) => p.count);
  const renum = new Map(keep.map(([, i], n) => [i, n]));
  for (const it of data.items) it[1] = renum.get(it[1]);
  const payload = {
    built: new Date().toISOString(),
    tags: readTags(),
    packs: keep.map(([p]) => p),
    dirs: data.dirs,
    items: data.items,
    notes: data.notes,
  };
  const page = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8')
    .replace('/*__LIBRARY_DATA__*/null', () => JSON.stringify(payload).replace(/</g, '\\u003c'));
  const out = path.join(root, 'index.html');
  fs.writeFileSync(out, page);

  const counts = {};
  for (const it of data.items) counts[it[0]] = (counts[it[0]] || 0) + 1;
  console.log(`Library page built: ${out}`);
  console.log(`  ${data.items.length} assets in ${payload.packs.length} packs and folders` +
    ` (${counts.image || 0} images, ${counts.sound || 0} sounds, ${counts.font || 0} fonts, ${counts.model || 0} 3D models)` +
    `, read in ${(data.ms / 1000).toFixed(1)} s`);
  const unlicensed = payload.packs.filter(p => p.status === 'none').map(p => p.name);
  if (unlicensed.length) console.log(`  No licence note yet: ${unlicensed.join(', ')}`);
  const check = payload.packs.filter(p => p.status === 'check').map(p => p.name);
  if (check.length) console.log(`  Licence to check before use: ${check.join(', ')}`);
  return out;
}

// ---------- tags ----------
// Gabriel's own tags, by the asset's file path: { "packs/x/a.png": ["Pierresavant", "menu"] }.

const tagsFile = () => path.join(root, 'tags.json');

function readTags() {
  try { return cleanTags(JSON.parse(fs.readFileSync(tagsFile(), 'utf8'))); } catch { return {}; }
}

/** Keeps only { path: [non-empty tags] }, sorted, so the file stays tidy. */
function cleanTags(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a tag list');
  for (const key of Object.keys(raw).sort()) {
    const list = raw[key];
    if (!Array.isArray(list)) continue;
    const tags = [...new Set(list.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 60)).filter(Boolean))].sort();
    if (tags.length && !key.includes('..')) out[key] = tags;
  }
  return out;
}

function saveTags(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 20e6) req.destroy(); });
  req.on('end', () => {
    try {
      const tags = cleanTags(JSON.parse(body));
      const tmp = tagsFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(tags, null, 1) + '\n');
      fs.renameSync(tmp, tagsFile());
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

// ---------- local server ----------

const MIME = {
  html: 'text/html; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', bin: 'application/octet-stream', obj: 'text/plain; charset=utf-8',
  mtl: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8', pdf: 'application/pdf',
};

function serve(port, tries = 10) {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (rel === '/api/tags') {
      // Only the page itself may save tags (a page on another site cannot set this header without asking).
      if (req.method === 'POST' && req.headers['x-library'] === '1') saveTags(req, res);
      else if (req.method === 'GET') res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(readTags()));
      else res.writeHead(403).end();
      return;
    }
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
      const ext = path.extname(file).slice(1).toLowerCase();
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Accept-Ranges': 'bytes' };
      if (ext !== 'html') headers['Cache-Control'] = 'max-age=3600';
      // Ranges let long sounds start playing (and seek) before they are fully sent.
      const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? +range[1] : Math.max(0, st.size - +range[2]);
        const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
        if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    });
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && tries > 0) serve(port + 1, tries - 1);
    else { console.log(`Could not start the page's server: ${err.message}`); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`\nLibrary open at ${url}  (only on this computer; press Ctrl+C to stop)`);
    if (!flags.has('--no-open')) {
      const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
    }
  });
}

build();
if (!flags.has('--build')) serve(portArg >= 0 ? +args[portArg + 1] || 4321 : 4321);
