#!/usr/bin/env node
// Game essentials checklist: looks through a Godot project and writes
// <project>/docs/checklist/checklist.md. For each system that almost every game
// needs, it says whether the project has it, whether it needs a look, or whether
// it is missing, and shows where it found it.
//
//   node checklist.mjs <project folder>
//
// The list is in essentials.mjs. To say an item is not needed for this game, add
// it to <project>/docs/checklist/decisions.json with the reason, e.g.
//   { "language-picker": "English only for now" }
// No dependencies; needs Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import { ESSENTIALS, GROUPS } from './essentials.mjs';

const IGNORE_DIRS = new Set(['.godot', '.git', '.claude', 'build', 'addons', 'node_modules', '.import', 'docs']);
const CODE_FILE = /\.(gd|tscn|tres|cfg|csv|po|translation|md)$/i;
// Only scripts and scenes are read for words (translation and data files are full of
// ordinary words). Tests and tools are only checked by file name, so a test that
// mentions "save" does not count as a save system.
const TEXT_FILE = /\.(gd|tscn)$|^project\.godot$/i;
const NAME_ONLY_DIRS = /^(tests?|tools)\//i;
const MAX_BYTES = 2_000_000;
const LABEL = { there: 'There', check: 'Check', missing: 'Missing', 'not-needed': 'Not needed' };

const project = process.argv[2];
if (!project) {
  console.error('Give the project folder, for example: node checklist.mjs "../Pierresavant"');
  process.exit(1);
}
const root = path.resolve(project);
if (!fs.existsSync(path.join(root, 'project.godot'))) {
  console.error(`There is no project.godot in ${root}. Point the tool at the folder that holds it.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && (CODE_FILE.test(entry.name) || entry.name === 'project.godot')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root).map((full) => ({
  full,
  rel: path.relative(root, full).split(path.sep).join('/'),
}));

const textFiles = files
  .filter((f) => TEXT_FILE.test(f.rel) && !NAME_ONLY_DIRS.test(f.rel) && fs.statSync(f.full).size <= MAX_BYTES)
  .map((f) => ({ rel: f.rel, text: fs.readFileSync(f.full, 'utf8') }));

const decisionsPath = path.join(root, 'docs', 'checklist', 'decisions.json');
let decisions = {};
if (fs.existsSync(decisionsPath)) {
  try {
    decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${decisionsPath}: ${err.message}. Fix the file or delete it.`);
    process.exit(1);
  }
}

function evaluate(item) {
  const textHits = [];
  for (const re of item.text) {
    for (const f of textFiles) {
      if (re.test(f.text) && !textHits.includes(f.rel)) textHits.push(f.rel);
    }
  }
  const nameHits = files
    .filter((f) => item.file.some((re) => re.test(f.rel)))
    .map((f) => f.rel);

  const reason = decisions[item.id];
  let status;
  if (reason) status = 'not-needed';
  else if (textHits.length || (item.proof && nameHits.length)) status = 'there';
  else if (nameHits.length) status = 'check';
  else status = 'missing';

  const evidence = [...new Set([...textHits, ...nameHits])].slice(0, 3);
  return { ...item, status, reason, evidence };
}

function projectName() {
  const cfg = fs.readFileSync(path.join(root, 'project.godot'), 'utf8');
  const m = cfg.match(/config\/name="([^"]*)"/);
  return m ? m[1] : path.basename(root);
}

const results = ESSENTIALS.map(evaluate);
const count = (s) => results.filter((r) => r.status === s).length;
const name = projectName();
const today = new Date().toISOString().slice(0, 10);

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const where = (r) => {
  if (r.status === 'not-needed') return r.reason;
  if (!r.evidence.length) return '-';
  return r.evidence.map((p) => `\`${p}\``).join(', ');
};

let md = `# Game essentials: ${name}\n\n`;
md += `Checked on ${today}. The tool reads the game's code and data files. It cannot play the game, so check the "Check" lines by hand.\n\n`;
md += `**${count('there')} there · ${count('check')} to check · ${count('missing')} missing · ${count('not-needed')} marked not needed**\n\n`;

const missing = results.filter((r) => r.status === 'missing');
md += `## To do\n\n`;
md += missing.length
  ? missing.map((r) => `- **${r.name}**: ${r.why}`).join('\n') + '\n\n'
  : 'Nothing is missing.\n\n';

for (const group of GROUPS) {
  const rows = results.filter((r) => r.group === group);
  if (!rows.length) continue;
  md += `## ${group}\n\n`;
  md += `| Item | Status | Where it was found | Why it matters |\n|---|---|---|---|\n`;
  for (const r of rows) {
    md += `| ${cell(r.name)} | ${LABEL[r.status]} | ${cell(where(r))} | ${cell(r.why)} |\n`;
  }
  md += '\n';
}

md += `---\n\n`;
md += `"There" means the code or data mentions it. "Check" means only a file name matches, so look at it yourself. `;
md += `To say an item is not needed in this game, add it to \`docs/checklist/decisions.json\` with a reason, e.g. \`{ "language-picker": "English only" }\`, and run the tool again.\n`;

const outDir = path.join(root, 'docs', 'checklist');
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(decisionsPath)) {
  fs.writeFileSync(decisionsPath, JSON.stringify({ _help: 'Add "item-id": "reason" for each item this game does not need. Item ids are in tools/checklist/essentials.mjs.' }, null, 2) + '\n');
}
const outPath = path.join(outDir, 'checklist.md');
fs.writeFileSync(outPath, md);

console.log(`Checked ${files.length} files in ${name}.`);
console.log(`${count('there')} there, ${count('check')} to check by hand, ${count('missing')} missing, ${count('not-needed')} marked not needed.`);
if (missing.length) {
  console.log('Missing:');
  for (const r of missing) console.log(`  - ${r.name}`);
}
console.log(`Report: ${outPath}`);
