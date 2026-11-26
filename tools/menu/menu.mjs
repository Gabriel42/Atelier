#!/usr/bin/env node
// Atelier main menu: one place to run every Atelier tool on a game.
//
//   node menu.mjs                     pick a game among the folders next to Atelier
//   node menu.mjs <project folder>    start on that game
//
// Arrow keys (or the number) to choose, Enter to run, Esc to go back, Q to quit.
// It writes nothing itself: each tool writes inside the game, as usual.
// No dependencies; needs Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const atelier = path.resolve(here, '..', '..');
const tool = (name) => path.join(atelier, 'tools', name, `${name}.mjs`);

const BACK = Symbol('back');
const QUIT = Symbol('quit');
const tty = process.stdin.isTTY && process.stdout.isTTY;
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const cyan = (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s);

// ---------- Small helpers ----------

/** The Godot projects in the folder that holds Atelier (Pierresavant, Love Will Find...). */
function findGames() {
  const parent = path.dirname(atelier);
  let names = [];
  try { names = fs.readdirSync(parent, { withFileTypes: true }); } catch { return []; }
  return names
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(parent, d.name, 'project.godot')))
    .map((d) => path.join(parent, d.name));
}

/** The game's name from project.godot, or its folder name. */
function gameName(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'project.godot'), 'utf8');
    const m = /^config\/name="(.*)"/m.exec(text);
    if (m) return m[1];
  } catch { /* fall through */ }
  return path.basename(root);
}

/** Runs a tool in this window. Ctrl+C stops the tool and comes back to the menu. */
function run(script, args) {
  return new Promise((resolve) => {
    console.log(dim(`\n> node ${path.relative(atelier, script)} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`));
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    const ignore = () => {};
    process.on('SIGINT', ignore);
    child.on('close', (code) => { process.off('SIGINT', ignore); resolve(code ?? 1); });
    child.on('error', (err) => { process.off('SIGINT', ignore); console.log(err.message); resolve(1); });
  });
}

/** Opens a file or web page with the computer's default app. */
function open(target) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

const pause = () => ask(dim('\nPress Enter to go back to the menu.'));

// ---------- The menu itself ----------

/**
 * Shows a list and returns the chosen item's value, BACK (Esc) or QUIT (Q).
 * items: [{ label, hint?, value }]
 */
async function choose(title, items, { canGoBack = true } = {}) {
  if (!tty) {
    console.log(`\n${title}`);
    items.forEach((it, i) => console.log(`  ${i + 1}. ${it.label}${it.hint ? `  - ${it.hint}` : ''}`));
    const answer = (await ask(`Number${canGoBack ? ', B to go back' : ''}, Q to quit: `)).toLowerCase();
    if (answer === 'q' || answer === '') return QUIT;
    if (answer === 'b' && canGoBack) return BACK;
    const n = Number(answer);
    return n >= 1 && n <= items.length ? items[n - 1].value : choose(title, items, { canGoBack });
  }

  let index = 0;
  const draw = () => {
    console.clear();
    console.log(bold('  Atelier') + dim('  Gabriel\'s gamedev workshop\n'));
    console.log(`  ${title}\n`);
    items.forEach((it, i) => {
      const line = `${i + 1}. ${it.label}`;
      const hint = it.hint ? dim(`  ${it.hint}`) : '';
      console.log(i === index ? cyan(`> ${bold(line)}`) + hint : `  ${line}${hint}`);
    });
    console.log(dim(`\n  Up/Down and Enter to choose${canGoBack ? ', Esc to go back' : ''}, Q to quit`));
  };

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const done = (value) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(value);
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return done(QUIT);
      if (key.name === 'up') index = (index + items.length - 1) % items.length;
      else if (key.name === 'down') index = (index + 1) % items.length;
      else if (key.name === 'return') return done(items[index].value);
      else if (key.name === 'escape' || key.name === 'backspace') { if (canGoBack) return done(BACK); }
      else if (str && str.toLowerCase() === 'q') return done(QUIT);
      else if (str && /^[1-9]$/.test(str) && +str <= items.length) return done(items[+str - 1].value);
      draw();
    };
    process.stdin.on('keypress', onKey);
    draw();
  });
}

// ---------- What each entry does ----------

async function codeAtlas(root) {
  const code = await run(tool('atlas'), [root]);
  const page = path.join(root, 'docs', 'atlas', 'index.html');
  if (code === 0 && fs.existsSync(page)) {
    open(page);
    console.log('\nOpened in the browser. To write the missing explanations, type /atlas in a Claude session inside the game.');
  }
  await pause();
}

async function checklist(root) {
  const code = await run(tool('checklist'), [root]);
  const report = path.join(root, 'docs', 'checklist', 'checklist.md');
  if (code === 0 && fs.existsSync(report)) {
    const answer = await ask('\nOpen the report? (Y/n) ');
    if (!/^n/i.test(answer)) open(report);
  } else await pause();
}

async function itch(root, name) {
  for (;;) {
    const choice = await choose(`${name} on itch.io`, [
      { label: 'What is ready', hint: 'checks Godot, butler, presets and the page; changes nothing', value: 'check' },
      { label: 'Build only', hint: 'builds into build/itch/, uploads nothing', value: 'build' },
      { label: 'Build and upload', hint: 'puts the new version on the game\'s itch.io page', value: 'upload' },
    ]);
    if (choice === BACK) return;
    if (choice === QUIT) return QUIT;
    if (choice === 'check') await run(tool('itch'), [root, '--check']);
    if (choice === 'build') await run(tool('itch'), [root, '--dry-run']);
    if (choice === 'upload') {
      const answer = await ask(`\nUpload ${name} to itch.io now? Players will see the new version. (y/N) `);
      if (!/^y/i.test(answer)) continue;
      await run(tool('itch'), [root]);
    }
    await pause();
  }
}

async function library() {
  console.log(dim('\nThe library opens in the browser. Press Ctrl+C here when you are done to come back to the menu.'));
  await run(tool('library'), [path.join(atelier, 'library')]);
}

async function gameMenu(root) {
  const name = gameName(root);
  for (;;) {
    const choice = await choose(bold(name) + dim(`  ${root}`), [
      { label: 'Code Atlas', hint: 'map of the code, every function explained', value: 'atlas' },
      { label: 'Essentials checklist', hint: 'what the game has and what it still needs', value: 'checklist' },
      { label: 'itch.io', hint: 'build the game and upload it', value: 'itch' },
      { label: 'Asset library', hint: 'browse the art, sounds, fonts and 3D models', value: 'library' },
    ]);
    if (choice === BACK || choice === QUIT) return choice;
    if (choice === 'atlas') await codeAtlas(root);
    if (choice === 'checklist') await checklist(root);
    if (choice === 'library') await library();
    if (choice === 'itch' && (await itch(root, name)) === QUIT) return QUIT;
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg) {
    const root = path.resolve(arg);
    if (!fs.existsSync(path.join(root, 'project.godot'))) {
      console.log(`No Godot game found at ${root} (it has no project.godot).`);
      return 1;
    }
    await gameMenu(root);
    return 0;
  }

  for (;;) {
    const games = findGames();
    const items = [
      ...games.map((root) => ({ label: gameName(root), value: root })),
      { label: 'Asset library', hint: 'for every game', value: 'library' },
    ];
    const choice = await choose(games.length ? 'Which game?' : `No Godot game found next to Atelier (in ${path.dirname(atelier)}).`,
      items, { canGoBack: false });
    if (choice === QUIT || choice === BACK) return 0;
    if (choice === 'library') { await library(); continue; }
    if ((await gameMenu(choice)) === QUIT) return 0;
  }
}

process.exitCode = await main();
if (tty) console.log('\nSee you soon.');
