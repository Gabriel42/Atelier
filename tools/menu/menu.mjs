#!/usr/bin/env node
// Atelier main menu: one page to run every Atelier tool on a game.
//
//   node menu.mjs                    build the page, open it in the browser with working buttons
//   node menu.mjs --build            build the page only (build/menu/index.html, ready to upload)
//   node menu.mjs <game folder>...   use these games instead of the ones next to Atelier
//   node menu.mjs --port 4310        use another port
//   node menu.mjs --shortcut         make Atelier.lnk (Windows), a shortcut to pin to the taskbar
//
// The page lists the Godot games in the folder that holds Atelier. Opened through this
// script (http://localhost:4310), its buttons run the tools and show their output. Opened
// any other way (as a file, or uploaded), it shows the commands to copy instead.
// The page holds no paths of this computer, only game names, versions and itch.io pages.
// No dependencies; needs Node 18+.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATELIER = path.resolve(HERE, '..', '..');
const OUT = path.join(ATELIER, 'build', 'menu', 'index.html');
const tool = (name) => path.join(ATELIER, 'tools', name, `${name}.mjs`);

// ---------- Reading the games ----------

function findGames(folders) {
  if (folders.length) return folders.map((f) => path.resolve(f));
  const parent = path.dirname(ATELIER);
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(parent, d.name, 'project.godot')))
    .map((d) => path.join(parent, d.name));
}

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const mtime = (file) => { try { return fs.statSync(file).mtime.toISOString(); } catch { return null; } };

/** Runs a command and gives back what it printed (empty if it failed). */
function output(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ATELIER, timeout: 30000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

/** The checklist report's items, read back from its tables. */
function checklistItems(report) {
  const STATUS = { 'There': 'there', 'Check': 'check', 'Missing': 'missing', 'Not needed': 'not-needed' };
  const items = [];
  let group = '';
  for (const line of report.split('\n')) {
    const h = /^## (.+)/.exec(line);
    if (h) { group = h[1].trim(); continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4 || !STATUS[cells[1]]) continue;
    const status = STATUS[cells[1]];
    const where = status === 'not-needed' ? [] : [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    items.push({ group, name: cells[0], status, where, why: cells[3], reason: status === 'not-needed' ? cells[2] : '' });
  }
  return items;
}

/** What the page shows about one game: no paths of this computer, only what is safe to upload. */
async function describe(root) {
  const project = read(path.join(root, 'project.godot')) || '';
  const field = (key) => new RegExp(`^config/${key}="(.*)"`, 'm').exec(project)?.[1] || '';

  let itch = null;
  try {
    const page = JSON.parse(read(path.join(root, 'itch.json')) || '{}').page || '';
    const m = /^([\w-]+)\/([\w-]+)$/.exec(page);
    itch = m ? `https://${m[1]}.itch.io/${m[2]}` : /^https:\/\//.test(page) ? page : null;
  } catch { /* no page */ }

  let checklist = null;
  const report = read(path.join(root, 'docs', 'checklist', 'checklist.md'));
  const counts = report && /\*\*(\d+) there · (\d+) to check · (\d+) missing · (\d+) marked not needed\*\*/.exec(report);
  if (counts) {
    const [there, check, missing, notNeeded] = counts.slice(1).map(Number);
    const date = mtime(path.join(root, 'docs', 'checklist', 'checklist.md'));
    checklist = { there, check, missing, notNeeded, date, items: checklistItems(report) };
  }

  // How many functions the Atlas explains (read from the code, so it works before a build too).
  const [stats, log, changes] = await Promise.all([
    output(process.execPath, [tool('atlas'), root, '--stats']),
    output('git', ['-C', root, 'log', '-1', '--format=%cI']),
    output('git', ['-C', root, 'status', '--porcelain']),
  ]);
  const s = /(\d+) scripts;.*?(\d+) up to date, (\d+) outdated, (\d+) missing/.exec(stats);
  const atlas = s ? { scripts: +s[1], ok: +s[2], stale: +s[3], missing: +s[4] } : null;

  return {
    name: field('name') || path.basename(root),
    folder: path.basename(root),
    version: field('version'),
    itch,
    atlas,
    atlasBuilt: mtime(path.join(root, 'docs', 'atlas', 'index.html')),
    checklist,
    lastCommit: log.trim() || null,
    changes: changes.split('\n').filter(Boolean).length,
  };
}

async function state(games, port) {
  return { built: new Date().toISOString(), port, games: await Promise.all(games.map(describe)) };
}

function page(data) {
  return fs.readFileSync(path.join(HERE, 'page.html'), 'utf8')
    .replace('/*__ATELIER_DATA__*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'));
}

async function build(games, port) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page(await state(games, port)));
  return OUT;
}

// ---------- Running the tools for the page ----------

function open(target) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

/** The command behind each button. Only these can run: the page sends a name, never a command. */
function command(action, root) {
  switch (action) {
    case 'atlas': return [tool('atlas'), root];
    case 'checklist': return [tool('checklist'), root];
    case 'itch-check': return [tool('itch'), root, '--check'];
    case 'itch-build': return [tool('itch'), root, '--dry-run'];
    case 'itch-upload': return [tool('itch'), root];
    default: return null;
  }
}

let library = null;   // the library's own server, started once

function serve(games, port) {
  let running = null;

  const server = http.createServer(async (req, res) => {
    // Only this computer's browser, on this page: no other site can make it run anything.
    if (!new RegExp(`^(localhost|127\\.0\\.0\\.1):${port}$`).test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(page(await state(games, port)));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await state(games, port)));
    }
    if (req.method !== 'POST' || req.headers['x-atelier'] !== '1') { res.writeHead(404); return res.end(); }

    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(body); } catch { /* empty */ }
      const root = Number.isInteger(msg.game) ? games[msg.game] : null;

      if (url.pathname === '/api/open') {
        const file = msg.what === 'atlas' ? ['docs', 'atlas', 'index.html'] : msg.what === 'checklist' ? ['docs', 'checklist', 'checklist.md'] : null;
        if (root && file && fs.existsSync(path.join(root, ...file))) open(path.join(root, ...file));
        res.writeHead(204); return res.end();
      }
      if (url.pathname !== '/api/run') { res.writeHead(404); return res.end(); }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });

      if (msg.action === 'library') {
        if (library && library.exitCode === null) {
          open('http://localhost:4321/');
          return res.end('The library is already open at http://localhost:4321/\n\n[exit 0]\n');
        }
        library = spawn(process.execPath, [tool('library'), path.join(ATELIER, 'library')], { cwd: ATELIER });
        let said = '';
        const onOut = (c) => {
          said += c;
          res.write(c);
          if (/Library open at/.test(said)) { library.stdout.off('data', onOut); res.end('\n[exit 0]\n'); }
        };
        library.stdout.on('data', onOut);
        library.stderr.on('data', (c) => res.writableEnded || res.write(c));
        library.on('close', (code) => res.writableEnded || res.end(`\n[exit ${code ?? 1}]\n`));
        return;
      }

      const args = root && command(msg.action, root);
      if (!args) return res.end('Unknown game or action.\n[exit 1]\n');
      if (running) return res.end('Another tool is still running; wait for it to finish.\n[exit 1]\n');

      console.log(`Running ${msg.action} on ${path.basename(root)}...`);
      running = spawn(process.execPath, args, { cwd: ATELIER, env: { ...process.env, NO_COLOR: '1' } });
      running.stdout.on('data', (c) => res.write(c));
      running.stderr.on('data', (c) => res.write(c));
      running.on('error', (e) => res.write(`${e.message}\n`));
      running.on('close', (code) => { running = null; res.end(`\n[exit ${code ?? 1}]\n`); });
    });
  });

  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.log(`Could not start the menu: ${err.message}`);
      process.exit(1);
    }
    // The port is taken: by the menu itself (open it again) or by something else (try the next one).
    const url = `http://localhost:${port}/`;
    const isMenu = await fetch(`${url}api/state`).then((r) => r.json()).then((d) => Array.isArray(d.games)).catch(() => false);
    if (isMenu) {
      console.log(`The menu is already open at ${url} (opening it again).`);
      if (!flags.has('--no-open')) open(url);
      process.exit(0);
    }
    if (port - firstPort >= 10) { console.log(`Could not find a free port from ${firstPort} to ${port}.`); process.exit(1); }
    serve(games, port + 1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`Atelier menu open at ${url}  (only on this computer; press Ctrl+C to stop)`);
    if (!flags.has('--no-open')) open(url);
  });
}

// ---------- Start ----------

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) || 4310 : 4310;
const firstPort = port;
const folders = args.filter((a, i) => !a.startsWith('--') && !(portAt >= 0 && i === portAt + 1));

if (flags.has('--shortcut')) process.exit(await shortcut());

/** Writes Atelier.lnk in the Atelier folder: a Windows shortcut that opens the menu, to pin to the taskbar. */
async function shortcut() {
  if (process.platform !== 'win32') { console.log('The shortcut is for Windows only.'); return 1; }
  const lnk = path.join(ATELIER, 'Atelier.lnk');
  const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK)
$s.TargetPath = $env:NODE
$s.Arguments = '"' + $env:MENU + '"'
$s.WorkingDirectory = $env:ATELIER
$s.IconLocation = $env:ICON + ',0'
$s.WindowStyle = 7
$s.Description = 'Atelier: the menu of Gabriel''s gamedev tools'
$s.Save()`;
  const ok = await new Promise((resolve) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, LNK: lnk, NODE: process.execPath, MENU: fileURLToPath(import.meta.url), ATELIER, ICON: path.join(HERE, 'atelier.ico') },
    windowsHide: true,
  }, (err, _out, errText) => { if (err) console.log(`Could not make the shortcut: ${errText || err.message}`); resolve(!err); }));
  if (!ok) return 1;
  console.log(`Shortcut made: ${lnk}`);
  console.log('To put it in the taskbar: right-click it, then "Show more options" > "Pin to taskbar" (or drag it onto the taskbar).');
  return 0;
}

const games = findGames(folders);
const missing = games.find((g) => !fs.existsSync(path.join(g, 'project.godot')));
if (missing) {
  console.log(`No Godot game found at ${missing} (it has no project.godot).`);
  process.exit(1);
}

const file = await build(games, port);
console.log(`Menu page built: ${path.relative(ATELIER, file)}  (${games.length} games; this file is the one to upload)`);
if (!flags.has('--build')) serve(games, port);
