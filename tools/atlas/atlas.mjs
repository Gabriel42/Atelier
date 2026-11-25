#!/usr/bin/env node
// Code Atlas: reads a Godot project's GDScript and writes one HTML page that
// maps the code (folders, scripts, functions, who calls whom, signals) with a
// plain-language explanation of every function.
//
//   node atlas.mjs <project>                    build <project>/docs/atlas/index.html
//   node atlas.mjs <project> --todo [filter]    list functions with no (or an outdated) explanation, as JSON
//   node atlas.mjs <project> --apply <file>     merge explanations from a JSON file ({ "path.gd": { "func": "text" } })
//   node atlas.mjs <project> --stats            print counts only
//
// Explanations live in <project>/docs/atlas/explanations.json, each stamped
// with a hash of the function's code, so a changed function shows as outdated.
// No dependencies; needs Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const IGNORE_DIRS = new Set(['.godot', '.git', '.claude', 'build', 'addons', 'node_modules', '.import']);

/** Method names too common to link by name alone (they exist on Godot's own types). */
const GENERIC = new Set(`new clear size has get set add remove find is_empty duplicate update show hide
connect disconnect emit append erase keys values free queue_free queue_redraw min max push_back pop_back
insert sort call bind get_parent add_child remove_child get_child get_children get_node has_method is_valid
open close load save start stop play reset refresh resize contains merge front back count instantiate
get_name get_type to_string hash fill slice filter map reduce any all pick_random shuffle reverse
get_size get_position get_rect draw setup apply`.split(/\s+/));

const ENGINE_CALLBACKS = {
  _init: 'Runs when the object is created (`.new()` or when its scene is loaded).',
  _ready: 'Godot calls this once, when the node and its children have joined the scene.',
  _process: 'Godot calls this every frame.',
  _physics_process: 'Godot calls this at every physics step (60 times a second by default).',
  _input: 'Godot calls this for every input event (key, mouse, …), before the UI gets it.',
  _unhandled_input: 'Godot calls this for input events nothing else used.',
  _unhandled_key_input: 'Godot calls this for key presses nothing else used.',
  _shortcut_input: 'Godot calls this for shortcut key events.',
  _gui_input: 'Godot calls this when this control receives mouse or keyboard input.',
  _draw: 'Godot calls this when the node has to be redrawn (after `queue_redraw()`).',
  _notification: 'Godot calls this for engine notifications (resized, theme changed, …).',
  _enter_tree: 'Godot calls this when the node joins the scene tree.',
  _exit_tree: 'Godot calls this when the node leaves the scene tree.',
  _get_minimum_size: 'Godot calls this to know the smallest size this control accepts.',
  _to_string: 'Godot calls this to turn the object into text (e.g. for `print`).',
  _get_drag_data: 'Godot calls this when a drag starts on this control.',
  _can_drop_data: 'Godot calls this to know if dragged data can be dropped here.',
  _drop_data: 'Godot calls this when dragged data is dropped here.',
  _make_custom_tooltip: 'Godot calls this to build this control\'s tooltip.',
  _get_tooltip: 'Godot calls this to get this control\'s tooltip text.',
  _has_point: 'Godot calls this to know if a point is inside this control.',
  _initialize: 'Godot calls this once when the script is run as the main loop (`--script`).',
  _finalize: 'Godot calls this when the main loop ends.',
  _get_configuration_warnings: 'Godot calls this in the editor to show warnings on the node.',
  _validate_property: 'Godot calls this in the editor to adjust how a property is shown.',
  _get: 'Godot calls this when a property that is not declared is read.',
  _set: 'Godot calls this when a property that is not declared is written.',
  _get_property_list: 'Godot calls this to list extra properties.',
};

// ───────────────────────────────────────────── files

function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) visit(path.join(dir, entry.name));
      } else if (/\.(gd|tscn|tres)$/.test(entry.name)) {
        out.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/'));
      }
    }
  };
  visit(root);
  return out.sort();
}

function groupOf(rel) {
  const parts = rel.split('/');
  parts.pop();
  if (parts.length === 0) return '(root)';
  const top = parts[0];
  if (top === 'tests' || top === 'tools') return top;
  return parts.slice(0, 2).join('/');
}

// ───────────────────────────────────────────── parsing

/** Replaces comments and string contents with nothing, keeping line breaks. */
function stripCode(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      i += quote.length;
      while (i < src.length && !src.startsWith(quote, i)) {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += quote.length;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function baseType(type) {
  if (!type) return null;
  const m = type.trim().match(/^([A-Za-z_]\w*)$/);
  return m ? m[1] : null;
}

/** Type of `name<rest>` where rest is what follows the name in a declaration. */
function declaredType(rest) {
  rest = rest.trim();
  let m;
  if (rest.startsWith(':=')) {
    m = rest.slice(2).trim().match(/^([A-Z]\w*)\.new\(/);
    return m ? m[1] : null;
  }
  if (rest.startsWith(':')) {
    m = rest.slice(1).match(/^\s*([A-Za-z_]\w*)\s*(=|:|$)/);
    return m ? m[1] : null;
  }
  return null;
}

function splitParams(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of text) {
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseScript(rel, text) {
  const lines = text.split(/\r?\n/);
  const script = {
    path: rel, group: groupOf(rel), className: null, extends: null, tool: false,
    doc: '', signals: [], members: [], funcs: [], lines: lines.length,
    memberTypes: {}, loads: [], text,
  };

  // Header: class_name, extends, then the script's own ## comment.
  let headerDoc = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (/^@tool\b/.test(l)) { script.tool = true; continue; }
    if ((m = l.match(/^class_name\s+(\w+)/))) {
      script.className = m[1];
      const e = l.match(/\bextends\s+(\S+)/);
      if (e) script.extends = e[1].replace(/"/g, '');
      continue;
    }
    if ((m = l.match(/^extends\s+(\S+)/))) { script.extends = m[1].replace(/"/g, ''); continue; }
    if (/^##/.test(l)) { headerDoc.push(l.replace(/^##\s?/, '')); continue; }
    if (l.trim() === '' && headerDoc.length === 0) continue;
    // A ## block glued to a declaration documents that declaration, not the script.
    if (l.trim() !== '' && headerDoc.length > 0) headerDoc = [];
    break;
  }
  script.doc = headerDoc.join('\n').trim();

  let pending = [];
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    let m;
    if (/^##/.test(l)) { pending.push(l.replace(/^##\s?/, '')); continue; }
    if (/^@\w+/.test(l) && !/\b(var|func)\b/.test(l)) continue; // lone annotation, keep the doc
    const doc = pending.join('\n').trim();
    pending = [];
    if ((m = l.match(/^signal\s+(\w+)\s*(\(.*\))?/))) {
      script.signals.push({ name: m[1], params: m[2] || '', doc, line: n + 1, emitters: [], listeners: [] });
      continue;
    }
    if ((m = l.match(/^((?:@\w+(?:\([^)]*\))?\s+)*)(static\s+)?(var|const)\s+(\w+)(.*)$/))) {
      const type = declaredType(m[5]);
      if (type) script.memberTypes[m[4]] = type;
      let decl = l.trim().replace(/:\s*$/, '');
      if (/[\[({]\s*$/.test(decl)) decl += ' …';
      if (decl.length > 110) decl = decl.slice(0, 107) + '…';
      script.members.push({ name: m[4], kind: m[3], exported: /@export/.test(m[1]), decl, doc, line: n + 1 });
      continue;
    }
    if ((m = l.match(/^enum\s+(\w+)/))) {
      script.members.push({ name: m[1], kind: 'enum', exported: false, decl: l.trim().slice(0, 110), doc, line: n + 1 });
      continue;
    }
    if ((m = l.match(/^(static\s+)?func\s+(\w+)\s*\(/))) {
      // The signature can span several lines: read until the brackets close.
      let end = n;
      let depth = 0;
      let sig = '';
      for (; end < lines.length; end++) {
        const code = stripCode(lines[end]);
        for (const c of code) {
          if ('([{'.includes(c)) depth++;
          if (')]}'.includes(c)) depth--;
        }
        sig += (sig ? ' ' : '') + lines[end].trim();
        if (depth <= 0 && /:\s*$/.test(code.trim())) break;
      }
      const bodyStart = end + 1;
      let last = end;
      for (let b = bodyStart; b < lines.length; b++) {
        if (lines[b].trim() === '') continue;
        if (!/^\s/.test(lines[b])) break;
        last = b;
      }
      const src = lines.slice(n, last + 1).join('\n');
      const body = lines.slice(bodyStart, last + 1).join('\n');
      sig = sig.replace(/:\s*(#.*)?$/, '').replace(/\s+/g, ' ');
      const open = sig.indexOf('(');
      const close = sig.lastIndexOf(')');
      const localTypes = {};
      for (const p of splitParams(sig.slice(open + 1, close))) {
        const pm = p.trim().match(/^(\w+)(.*)$/);
        if (pm) {
          const t = declaredType(pm[2]);
          if (t) localTypes[pm[1]] = t;
        }
      }
      for (const lm of body.matchAll(/\b(?:var|for)\s+(\w+)\s*(:=?[^\n]*)/g)) {
        const t = declaredType(lm[2].replace(/\s+in\s.*$/, ''));
        if (t) localTypes[lm[1]] = t;
      }
      script.funcs.push({
        name: m[2], sig, line: n + 1, doc, static: !!m[1], private: m[2].startsWith('_'),
        engine: ENGINE_CALLBACKS[m[2]] || '', src, body: stripCode(body), localTypes,
        hash: crypto.createHash('sha1').update(src.replace(/\s+$/gm, '')).digest('hex').slice(0, 10),
        calls: [], calledBy: [], handles: [],
      });
      n = last;
      continue;
    }
  }

  for (const lm of text.matchAll(/\b(?:preload|load)\(\s*"res:\/\/([^"]+)"/g)) script.loads.push(lm[1]);
  return script;
}

// ───────────────────────────────────────────── analysis

function analyse(root) {
  const files = walk(root);
  const scripts = files.filter((f) => f.endsWith('.gd'))
    .map((f) => parseScript(f, fs.readFileSync(path.join(root, f), 'utf8')));
  const byPath = Object.fromEntries(scripts.map((s) => [s.path, s]));
  const byClass = {};
  for (const s of scripts) if (s.className) byClass[s.className] = s;

  // project.godot: name and autoloads.
  let projectName = path.basename(root);
  const autoloads = {};
  const projectFile = path.join(root, 'project.godot');
  if (fs.existsSync(projectFile)) {
    const text = fs.readFileSync(projectFile, 'utf8');
    const nm = text.match(/^config\/name="([^"]+)"/m);
    if (nm) projectName = nm[1];
    const section = text.split(/^\[autoload\]\s*$/m)[1];
    if (section) {
      for (const am of section.split(/^\[/m)[0].matchAll(/^(\w+)="\*?res:\/\/([^"]+)"/gm)) {
        if (byPath[am[2]]) {
          autoloads[am[1]] = byPath[am[2]];
          byPath[am[2]].autoload = am[1];
        }
      }
    }
  }

  const named = (name) => byClass[name] || autoloads[name] || null;
  const parentOf = (s) => {
    if (!s.extends) return null;
    if (s.extends.startsWith('res://')) return byPath[s.extends.slice(6)] || null;
    return byClass[s.extends] || null;
  };
  const chain = (s) => {
    const out = [];
    for (let c = s, guard = 0; c && guard < 20; c = parentOf(c), guard++) out.push(c);
    return out;
  };
  const findFunc = (s, name) => {
    for (const c of chain(s)) {
      const f = c.funcs.find((x) => x.name === name);
      if (f) return { s: c, f };
    }
    return null;
  };
  const findSignal = (s, name) => {
    for (const c of chain(s)) {
      const g = c.signals.find((x) => x.name === name);
      if (g) return { s: c, g };
    }
    return null;
  };

  const funcDefs = {};
  const signalDefs = {};
  const memberTypeTable = {};
  for (const s of scripts) {
    for (const f of s.funcs) (funcDefs[f.name] ||= []).push({ s, f });
    for (const g of s.signals) (signalDefs[g.name] ||= []).push({ s, g });
    for (const [name, type] of Object.entries(s.memberTypes)) (memberTypeTable[name] ||= new Set()).add(type);
  }

  /** The project script an expression like `a.b.c` most likely is an instance of. */
  const typeOfReceiver = (s, f, receiver, chained) => {
    if (receiver === 'self') return s;
    if (receiver === 'super') return parentOf(s);
    if (!chained) {
      const local = f.localTypes[receiver];
      if (local && named(local)) return named(local);
      for (const c of chain(s)) {
        const t = c.memberTypes[receiver];
        if (t && named(t)) return named(t);
      }
    }
    if (named(receiver)) return named(receiver);
    const types = memberTypeTable[receiver];
    if (types && types.size === 1) {
      const t = named([...types][0]);
      if (t) return t;
    }
    return null;
  };

  const uses = new Map(scripts.map((s) => [s, new Set()]));
  const addCall = (s, f, target, guess) => {
    if (target.f === f) return;
    if (!f.calls.some((c) => c.s === target.s.path && c.f === target.f.name)) {
      f.calls.push({ s: target.s.path, f: target.f.name, g: guess ? 1 : 0 });
      target.f.calledBy.push({ s: s.path, f: f.name, g: guess ? 1 : 0 });
    }
    if (target.s !== s) uses.get(s).add(target.s);
  };

  for (const s of scripts) {
    for (const f of s.funcs) {
      const body = f.body;
      // Calls: name(…) and receiver.name(…)
      for (const m of body.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
        const name = m[1];
        const before = body.slice(0, m.index);
        if (!before.endsWith('.')) {
          if (/\bfunc\s+$/.test(before)) continue;
          const target = findFunc(s, name);
          if (target) addCall(s, f, target, false);
          continue;
        }
        if (name === 'new' || name === 'emit' || name === 'connect') continue;
        const rm = before.match(/(\.)?\s*([A-Za-z_]\w*)\.$/);
        let target = null;
        let guess = false;
        if (rm) {
          const owner = typeOfReceiver(s, f, rm[2], !!rm[1]);
          if (owner) target = findFunc(owner, name);
        }
        if (!target && funcDefs[name]?.length === 1 && !GENERIC.has(name) && !ENGINE_CALLBACKS[name]) {
          target = funcDefs[name][0];
          guess = true;
        }
        if (target) addCall(s, f, target, guess);
      }
      // Own functions passed around by name (signal handlers, callables).
      for (const c of chain(s)) {
        for (const other of c.funcs) {
          if (other === f || ENGINE_CALLBACKS[other.name]) continue;
          const re = new RegExp(`(?<![\\w.])${other.name}\\b(?!\\s*\\()`);
          if (re.test(body) && !(other.name in f.localTypes)) addCall(s, f, { s: c, f: other }, false);
        }
      }
      // Signals: emitted here, or connected here to a handler.
      const resolveSignal = (expr) => {
        const parts = expr.split('.');
        const name = parts.pop();
        if (parts.length === 0) return findSignal(s, name);
        const owner = typeOfReceiver(s, f, parts[parts.length - 1], parts.length > 1);
        if (owner) {
          const found = findSignal(owner, name);
          if (found) return found;
        }
        return signalDefs[name]?.length === 1 ? signalDefs[name][0] : null;
      };
      for (const m of body.matchAll(/([A-Za-z_][\w.]*)\.emit\s*\(/g)) {
        const found = resolveSignal(m[1]);
        if (found && !found.g.emitters.some((e) => e.s === s.path && e.f === f.name)) {
          found.g.emitters.push({ s: s.path, f: f.name });
          if (found.s !== s) uses.get(s).add(found.s);
        }
      }
      for (const m of body.matchAll(/([A-Za-z_][\w.]*)\.connect\s*\(\s*([A-Za-z_][\w.]*)\s*[,)]/g)) {
        const handlerName = m[2].split('.').pop();
        const handler = m[2].includes('.') && !m[2].startsWith('self.') ? null : findFunc(s, handlerName);
        if (handler && !handler.f.handles.includes(m[1])) handler.f.handles.push(m[1]);
        const found = resolveSignal(m[1]);
        if (found) {
          found.g.listeners.push({ s: s.path, f: handler ? handler.f.name : f.name });
          if (found.s !== s) uses.get(s).add(found.s);
        }
      }
    }

    // Script-level links: extends, class names and autoloads mentioned, preloads.
    const code = stripCode(s.text);
    const parent = parentOf(s);
    if (parent) uses.get(s).add(parent);
    for (const [name, other] of [...Object.entries(byClass), ...Object.entries(autoloads)]) {
      if (other !== s && new RegExp(`\\b${name}\\b`).test(code)) uses.get(s).add(other);
    }
    s.scenesLoaded = [];
    for (const load of s.loads) {
      if (byPath[load]) uses.get(s).add(byPath[load]);
      else if (load.endsWith('.tscn')) s.scenesLoaded.push(load);
    }
  }

  // Scenes that use each script, signal connections made in scenes, data files.
  for (const s of scripts) { s.scenes = []; s.data = {}; }
  for (const file of files) {
    if (file.endsWith('.gd')) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const attached = new Set();
    for (const m of text.matchAll(/\[ext_resource[^\]]*path="res:\/\/([^"]+\.gd)"/g)) {
      if (byPath[m[1]]) attached.add(byPath[m[1]]);
    }
    if (file.endsWith('.tscn')) {
      for (const s of attached) s.scenes.push(file);
      for (const m of text.matchAll(/\[connection signal="(\w+)" from="([^"]*)" to="[^"]*" method="(\w+)"/g)) {
        for (const s of attached) {
          const f = s.funcs.find((x) => x.name === m[3]);
          if (f) f.handles.push(`${m[2] === '.' ? 'self' : m[2].split('/').pop()}.${m[1]} (in ${path.basename(file)})`);
        }
      }
    } else {
      const cm = text.match(/\[gd_resource[^\]]*script_class="(\w+)"/);
      const owner = cm && byClass[cm[1]] ? byClass[cm[1]] : [...attached][0];
      if (owner) {
        const dir = path.posix.dirname(file);
        owner.data[dir] = (owner.data[dir] || 0) + 1;
      }
    }
  }

  for (const s of scripts) {
    s.uses = [...uses.get(s)].map((o) => o.path).sort();
    s.parentPath = parentOf(s)?.path || null;
  }
  for (const s of scripts) s.usedBy = scripts.filter((o) => o.uses.includes(s.path)).map((o) => o.path);

  return { projectName, scripts };
}

// ───────────────────────────────────────────── explanations

function explanationsFile(root) {
  return path.join(root, 'docs', 'atlas', 'explanations.json');
}

function loadExplanations(root) {
  const file = explanationsFile(root);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function saveExplanations(root, data) {
  const sorted = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = {};
    for (const name of Object.keys(data[key]).sort()) sorted[key][name] = data[key][name];
  }
  const file = explanationsFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
}

/** 'ok', 'stale' (the code changed since it was written) or 'missing'. */
function explanationState(explanations, s, f) {
  const entry = explanations[s.path]?.[f.name];
  if (!entry) return 'missing';
  return entry.hash === f.hash ? 'ok' : 'stale';
}

// ───────────────────────────────────────────── commands

function build(root, outDir) {
  const { projectName, scripts } = analyse(root);
  const explanations = loadExplanations(root);
  let explained = 0;
  let total = 0;
  const data = {
    project: projectName,
    generated: new Date().toISOString().slice(0, 10),
    scripts: scripts.map((s) => ({
      path: s.path, group: s.group, className: s.className, extends: s.extends, parentPath: s.parentPath,
      tool: s.tool, autoload: s.autoload || null, doc: s.doc, lines: s.lines,
      uses: s.uses, usedBy: s.usedBy, scenes: s.scenes, scenesLoaded: s.scenesLoaded,
      data: Object.entries(s.data).map(([dir, count]) => ({ dir, count })),
      signals: s.signals,
      members: s.members.map(({ name, kind, exported, decl, doc }) => ({ name, kind, exported, decl, doc })),
      funcs: s.funcs.map((f) => {
        const state = explanationState(explanations, s, f);
        total++;
        if (state !== 'missing') explained++;
        return {
          name: f.name, sig: f.sig, line: f.line, doc: f.doc, static: f.static, private: f.private,
          engine: f.engine, src: f.src, calls: f.calls, calledBy: f.calledBy, handles: f.handles,
          explain: state === 'missing' ? '' : explanations[s.path][f.name].text,
          stale: state === 'stale',
        };
      }),
    })),
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const template = fs.readFileSync(path.join(here, 'page.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = template.replace('/*__ATLAS_DATA__*/null', () => json).replace(/__ATLAS_TITLE__/g, () => projectName);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'index.html');
  fs.writeFileSync(outFile, html);
  console.log(`Atlas of ${projectName}: ${scripts.length} scripts, ${total} functions, ${explained} explained.`);
  console.log(outFile);
}

function todo(root, filter) {
  const { scripts } = analyse(root);
  const explanations = loadExplanations(root);
  const out = [];
  for (const s of scripts) {
    if (filter ? !s.path.startsWith(filter) : s.group === 'tests') continue; // tests only when asked for
    for (const f of s.funcs) {
      const state = explanationState(explanations, s, f);
      if (state === 'ok') continue;
      out.push({
        path: s.path, func: f.name, state, doc: f.doc, src: f.src,
        previous: state === 'stale' ? explanations[s.path][f.name].text : undefined,
      });
    }
  }
  console.log(JSON.stringify(out, null, 1));
}

function apply(root, file) {
  const { scripts } = analyse(root);
  const explanations = loadExplanations(root);
  const incoming = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  let applied = 0;
  const unknown = [];
  for (const [scriptPath, funcs] of Object.entries(incoming)) {
    const s = scripts.find((x) => x.path === scriptPath);
    for (const [name, text] of Object.entries(funcs)) {
      const f = s?.funcs.find((x) => x.name === name);
      if (!f) { unknown.push(`${scriptPath}::${name}`); continue; }
      (explanations[scriptPath] ||= {})[name] = { hash: f.hash, text: String(text).trim() };
      applied++;
    }
  }
  // Drop explanations of functions that no longer exist.
  let removed = 0;
  for (const scriptPath of Object.keys(explanations)) {
    const s = scripts.find((x) => x.path === scriptPath);
    for (const name of Object.keys(explanations[scriptPath])) {
      if (!s?.funcs.some((x) => x.name === name)) { delete explanations[scriptPath][name]; removed++; }
    }
    if (Object.keys(explanations[scriptPath]).length === 0) delete explanations[scriptPath];
  }
  saveExplanations(root, explanations);
  console.log(`Applied ${applied} explanation(s), removed ${removed} for deleted functions.`);
  if (unknown.length) console.log(`Not found (skipped): ${unknown.join(', ')}`);
}

function stats(root) {
  const { projectName, scripts } = analyse(root);
  const explanations = loadExplanations(root);
  const count = { ok: 0, stale: 0, missing: 0 };
  for (const s of scripts) {
    if (s.group === 'tests') continue;
    for (const f of s.funcs) count[explanationState(explanations, s, f)]++;
  }
  console.log(`${projectName}: ${scripts.length} scripts; explanations (tests aside): ${count.ok} up to date, ${count.stale} outdated, ${count.missing} missing.`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('--')) {
  console.error('Usage: node atlas.mjs <project> [--todo [path prefix] | --apply <file> | --stats | --out <dir>]');
  process.exit(1);
}
const root = path.resolve(args[0]);
if (args[1] === '--todo') todo(root, args[2]);
else if (args[1] === '--apply') apply(root, args[2]);
else if (args[1] === '--stats') stats(root);
else build(root, args[1] === '--out' ? path.resolve(args[2]) : path.join(root, 'docs', 'atlas'));
