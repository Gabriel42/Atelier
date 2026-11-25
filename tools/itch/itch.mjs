#!/usr/bin/env node
// itch.io exporter: builds a Godot game and uploads it to its itch.io page.
//
//   node itch.mjs <project>                  build, then upload to itch.io
//   node itch.mjs <project> --dry-run        build only, upload nothing
//   node itch.mjs <project> --check          say what is ready and what is missing
//   node itch.mjs <project> --page <page>    remember the game's itch.io page
//                                            (https://you.itch.io/your-game or you/your-game)
//   node itch.mjs <project> --only web,windows   limit to some builds
//
// It uses the presets already in the project's export_presets.cfg (Web and
// Windows by default), builds them fresh into <project>/build/itch/, and sends
// each folder with butler, itch.io's own uploader. The version shown on itch.io
// is the one in project.godot. The page is kept in <project>/itch.json.
// No dependencies; needs Node 18+, Godot with its export templates, and butler.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Godot platform name -> itch.io channel (itch.io reads the channel name to tag the file). */
const CHANNELS = {
  'Web': 'html5',
  'Windows Desktop': 'windows',
  'Linux': 'linux',
  'Linux/X11': 'linux',
  'macOS': 'mac',
  'Android': 'android',
};
const DEFAULT_CHANNELS = ['html5', 'windows'];
const WINDOWS = process.platform === 'win32';

class Stop extends Error {}
const say = (text = '') => console.log(text);

// ---------- reading the project ----------

/** Reads a Godot .cfg / .godot file into { section: { key: value } } (values without quotes). */
function readCfg(file) {
  const out = {};
  let section = '';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const head = line.match(/^\[(.+)\]\s*$/);
    if (head) { section = head[1]; out[section] ??= {}; continue; }
    const pair = line.match(/^([^;=\s][^=]*)=(.*)$/);
    if (!pair) continue;
    let value = pair[2].trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1);
    (out[section] ??= {})[pair[1].trim()] = value;
  }
  return out;
}

function readProject(root) {
  const file = path.join(root, 'project.godot');
  if (!fs.existsSync(file)) throw new Stop(`No Godot project here: ${root}\n(there is no project.godot in that folder)`);
  const app = readCfg(file).application ?? {};
  const engine = (app['config/features'] ?? '').match(/"(\d+\.\d+)"/);
  return {
    name: app['config/name'] || path.basename(root),
    version: app['config/version'] || '',
    engine: engine ? engine[1] : '',
  };
}

function readPresets(root) {
  const file = path.join(root, 'export_presets.cfg');
  if (!fs.existsSync(file)) {
    throw new Stop('This project has no export presets yet.\nIn Godot: Project > Export, add "Web" and "Windows Desktop", then run this again.');
  }
  const cfg = readCfg(file);
  const presets = [];
  for (const [section, values] of Object.entries(cfg)) {
    if (!/^preset\.\d+$/.test(section)) continue;
    const options = cfg[`${section}.options`] ?? {};
    presets.push({
      name: values.name,
      platform: values.platform,
      channel: CHANNELS[values.platform] ?? null,
      exportPath: values.export_path ?? '',
      threads: options['variant/thread_support'] === 'true',
    });
  }
  return presets;
}

function readSettings(root) {
  const file = path.join(root, 'itch.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Stop(`itch.json could not be read (${file}). Fix it or delete it.`); }
}

/** "https://you.itch.io/game" or "you/game" -> "you/game"; null when it is neither. */
function parsePage(text) {
  const url = text.match(/^(?:https?:\/\/)?([a-z0-9_-]+)\.itch\.io\/([a-z0-9_-]+)\/?$/i);
  if (url) return `${url[1]}/${url[2]}`.toLowerCase();
  return /^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(text) ? text.toLowerCase() : null;
}
const pageUrl = (page) => { const [user, game] = page.split('/'); return `https://${user}.itch.io/${game}`; };

/** Which presets to build: --only, else "builds" in itch.json, else Web and Windows. */
function pickPresets(presets, only, settings) {
  const wanted = (only ?? settings.builds ?? DEFAULT_CHANNELS).map((w) => w.toLowerCase());
  const picked = presets.filter((p) => p.channel &&
    (wanted.includes(p.channel) || wanted.includes(p.name.toLowerCase()) ||
     (wanted.includes('web') && p.channel === 'html5')));
  if (!picked.length) {
    const have = presets.map((p) => p.name).join(', ') || 'none';
    throw new Stop(`No export preset matches "${wanted.join(', ')}". This project has: ${have}.`);
  }
  const seen = new Set();
  for (const p of picked) {
    if (seen.has(p.channel)) throw new Stop(`Two presets are for ${p.platform}. Pick one with --only "<preset name>".`);
    seen.add(p.channel);
  }
  return picked;
}

// ---------- finding Godot and butler ----------

function onPath(names) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = WINDOWS ? ['.exe', '.cmd', ''] : [''];
  for (const dir of dirs) for (const name of names) for (const ext of exts) {
    const file = path.join(dir, name + ext);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* not there */ }
  }
  return null;
}

function listFiles(dir, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile()) out.push(full);
    else if (e.isDirectory() && depth > 0) out.push(...listFiles(full, depth - 1));
  }
  return out;
}

const compareVersions = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** The Godot to use: GODOT if set, else the newest one that matches the project's Godot version. */
function findGodot(engine) {
  if (process.env.GODOT) {
    if (fs.existsSync(process.env.GODOT)) return process.env.GODOT;
    throw new Stop(`GODOT points to a file that does not exist: ${process.env.GODOT}`);
  }
  const home = os.homedir();
  const places = WINDOWS
    ? [path.join(home, 'Godot'), 'C:\\Godot', 'C:\\Program Files\\Godot', path.join(home, 'scoop', 'apps', 'godot', 'current')]
    : [path.join(home, 'Godot'), '/Applications/Godot.app/Contents/MacOS', path.join(home, '.local', 'bin')];
  const found = [];
  for (const place of places) for (const file of listFiles(place, 2)) {
    const m = path.basename(file).match(/^Godot(?:_v(\d+(?:\.\d+)+))?/i);
    if (!m || (WINDOWS && !/\.exe$/i.test(file))) continue;
    found.push({ file, version: m[1] ?? '', console: /_console\.exe$/i.test(file) });
  }
  const fits = (g) => engine && (g.version === engine || g.version.startsWith(engine + '.'));
  found.sort((a, b) => (fits(b) - fits(a)) || compareVersions(b.version, a.version) || (b.console - a.console));
  return found[0]?.file ?? onPath(['godot', 'godot4']);
}

function findButler() {
  if (process.env.BUTLER) {
    if (fs.existsSync(process.env.BUTLER)) return process.env.BUTLER;
    throw new Stop(`BUTLER points to a file that does not exist: ${process.env.BUTLER}`);
  }
  const exe = WINDOWS ? 'butler.exe' : 'butler';
  const home = os.homedir();
  const direct = [path.join(home, 'butler', exe), path.join(home, '.local', 'bin', exe)];
  for (const file of direct) if (fs.existsSync(file)) return file;
  const found = onPath(['butler']);
  if (found) return found;
  // The itch.io desktop app ships its own butler.
  const appDirs = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'itch', 'broth', 'butler', 'versions'),
    path.join(home, '.config', 'itch', 'broth', 'butler', 'versions'),
    path.join(home, 'Library', 'Application Support', 'itch', 'broth', 'butler', 'versions'),
  ].filter(Boolean);
  for (const dir of appDirs) {
    const hits = listFiles(dir, 1).filter((f) => path.basename(f) === exe).sort(compareVersions);
    if (hits.length) return hits[hits.length - 1];
  }
  return null;
}

/** butler keeps the itch.io login in this file after `butler login`. */
function butlerLoggedIn() {
  if (process.env.BUTLER_API_KEY) return true;
  const home = os.homedir();
  return [
    path.join(home, '.config', 'itch', 'butler_creds'),
    path.join(home, 'Library', 'Application Support', 'itch', 'butler_creds'),
  ].some((f) => fs.existsSync(f));
}

const BUTLER_HELP = `butler (itch.io's uploader) is not on this computer.
Get it from https://itchio.itch.io/butler, unzip it into ${path.join(os.homedir(), 'butler')}, then run this again.`;
const loginHelp = (butler) => `butler is not connected to your itch.io account yet. Run this once and click "Authorize" in the browser:\n  "${butler}" login`;

// ---------- building ----------

function sizeOf(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  return listFiles(target, 20).reduce((sum, f) => sum + fs.statSync(f).size, 0);
}
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const safeName = (name) => name.replace(/[<>:"/\\|?*]/g, '').trim() || 'game';

/** Builds one preset into a fresh folder under build/itch/ and returns what to upload. */
function build(godot, root, project, preset) {
  const dir = path.join(root, 'build', 'itch', preset.channel);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Keeps Godot from importing the built images back into the project.
  fs.writeFileSync(path.join(root, 'build', 'itch', '.gdignore'), '');

  const ext = path.extname(preset.exportPath) || { html5: '.html', windows: '.exe', mac: '.zip', android: '.apk' }[preset.channel] || '';
  const file = path.join(dir, preset.channel === 'html5' ? 'index.html' : safeName(project.name) + ext);

  const run = spawnSync(godot, ['--headless', '--path', root, '--export-release', preset.name, file],
    { encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const log = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;

  const needed = preset.channel === 'html5'
    ? ['index.html', 'index.js', 'index.wasm', 'index.pck'].map((f) => path.join(dir, f))
    : [file];
  const missing = needed.filter((f) => !fs.existsSync(f) || fs.statSync(f).size === 0);
  if (run.error || missing.length) {
    const errors = log.split(/\r?\n/).filter((l) => /error|missing|not found|fail/i.test(l)).slice(0, 12);
    throw new Stop([
      `The ${preset.name} build failed${missing.length ? ` (${missing.map((f) => path.basename(f)).join(', ')} was not made)` : ''}.`,
      run.error ? String(run.error.message) : '',
      ...(errors.length ? ['What Godot said:', ...errors.map((l) => '  ' + l.trim())] : []),
    ].filter(Boolean).join('\n'));
  }

  // A single zip or apk is sent as it is; anything else is sent as a folder.
  const made = fs.readdirSync(dir);
  const upload = made.length === 1 && /\.(zip|apk)$/i.test(made[0]) ? path.join(dir, made[0]) : dir;
  return { upload, size: sizeOf(dir) };
}

/** How many files have changes that are not committed (0 when git is not used). */
function uncommitted(root) {
  const run = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.split('\n').filter(Boolean).length : 0;
}

// ---------- commands ----------

function check(root, only) {
  const project = readProject(root);
  const settings = readSettings(root);
  const lines = [];
  let ready = true;
  const row = (ok, text) => { lines.push(`  ${ok ? 'ok     ' : 'MISSING'}  ${text}`); if (!ok) ready = false; };

  say(`${project.name} ${project.version}`);
  row(!!project.version, project.version ? `version ${project.version}` : 'no version in project.godot (Project Settings > Application > Config > Version)');
  try {
    const picked = pickPresets(readPresets(root), only, settings);
    row(true, `builds: ${picked.map((p) => p.name).join(', ')}`);
  } catch (e) { if (!(e instanceof Stop)) throw e; row(false, e.message.split('\n')[0]); }
  const godot = findGodot(project.engine);
  row(!!godot, godot ? `Godot: ${godot}` : 'Godot not found (set GODOT to its path)');
  const butler = findButler();
  row(!!butler, butler ? `butler: ${butler}` : 'butler not found (get it from https://itchio.itch.io/butler)');
  row(butlerLoggedIn(), butlerLoggedIn() ? 'connected to itch.io' : 'not connected to itch.io (run: butler login)');
  row(!!settings.page, settings.page ? `page: ${pageUrl(settings.page)}` : 'no itch.io page set (use --page https://you.itch.io/your-game)');
  say(lines.join('\n'));
  say(ready ? 'Ready to upload.' : 'Not ready yet: fix the lines marked MISSING.');
  return ready ? 0 : 1;
}

function setPage(root, text) {
  readProject(root);
  const page = parsePage(text ?? '');
  if (!page) throw new Stop('Give the page as https://you.itch.io/your-game (or you/your-game).');
  const settings = { ...readSettings(root), page };
  fs.writeFileSync(path.join(root, 'itch.json'), JSON.stringify(settings, null, 2) + '\n');
  say(`Saved: this game uploads to ${pageUrl(page)}`);
  return 0;
}

function release(root, { dryRun, only }) {
  const project = readProject(root);
  const settings = readSettings(root);
  const presets = pickPresets(readPresets(root), only, settings);
  if (!project.version) throw new Stop('The game has no version. Set it in Project Settings > Application > Config > Version.');

  const godot = findGodot(project.engine);
  if (!godot) throw new Stop('Godot was not found. Set GODOT to the path of the Godot program and run this again.');
  let butler = null;
  if (!dryRun) {
    if (!settings.page) throw new Stop('This game has no itch.io page set. Run once:\n  node itch.mjs <project> --page https://you.itch.io/your-game');
    butler = findButler();
    if (!butler) throw new Stop(BUTLER_HELP);
    if (!butlerLoggedIn()) throw new Stop(loginHelp(butler));
  }

  say(`${project.name} ${project.version}`);
  const changed = uncommitted(root);
  if (changed) say(`Note: ${changed} file${changed > 1 ? 's' : ''} changed since the last commit; the build includes them.`);

  const built = [];
  for (const preset of presets) {
    process.stdout.write(`Building ${preset.name}... `);
    const result = build(godot, root, project, preset);
    say(`done (${megabytes(result.size)})`);
    if (preset.channel === 'html5' && preset.threads) {
      say('Note: the Web preset uses threads. On the itch.io page, tick "SharedArrayBuffer support" or the game will not start.');
    }
    built.push({ preset, ...result });
  }

  if (dryRun) {
    say(`Built in ${path.join(root, 'build', 'itch')}. Nothing was uploaded (--dry-run).`);
    return 0;
  }

  for (const { preset, upload } of built) {
    say(`Uploading ${preset.name}...`);
    const run = spawnSync(butler, ['push', upload, `${settings.page}:${preset.channel}`, '--userversion', project.version],
      { stdio: 'inherit' });
    if (run.error || run.status !== 0) {
      throw new Stop(`The ${preset.name} upload failed. Builds before it were uploaded; this one and the ones after were not.\n` +
        `Check that the page exists (${pageUrl(settings.page)}) and that it belongs to the account butler is connected to.`);
    }
  }
  say(`Uploaded ${project.name} ${project.version} (${built.map((b) => b.preset.name).join(', ')}) to ${pageUrl(settings.page)}`);
  if (built.some((b) => b.preset.channel === 'html5')) {
    say('First Web upload only: on the page\'s "Edit game" screen, set "Kind of project" to HTML and tick "This file will be played in the browser" next to the html5 file.');
  }
  return 0;
}

// ---------- main ----------

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const option = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value ?? '';
  };
  const page = option('--page');
  const onlyText = option('--only');
  const only = onlyText === undefined ? undefined : onlyText.split(',').map((s) => s.trim()).filter(Boolean);
  const dryRun = flag('--dry-run');
  const doCheck = flag('--check');
  const unknown = args.find((a) => a.startsWith('--'));
  if (unknown) throw new Stop(`Unknown option: ${unknown}`);
  if (args.length !== 1) {
    say('Usage: node itch.mjs <project folder> [--dry-run] [--check] [--page <page>] [--only web,windows]');
    return 1;
  }
  const root = path.resolve(args[0]);
  if (page !== undefined) return setPage(root, page);
  if (doCheck) return check(root, only);
  return release(root, { dryRun, only });
}

try {
  process.exitCode = main();
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
