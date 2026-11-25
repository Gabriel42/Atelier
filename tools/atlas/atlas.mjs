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
  _static_init: 'Runs once, when the script is first loaded.',
  _input_event: 'Godot calls this when the mouse does something over this object.',
  _process_custom_fx: 'Godot calls this for every letter of a text that uses this effect, every frame.',
  _log_error: 'Godot calls this for every error or warning it reports.',
  _log_message: 'Godot calls this for every message it prints.',
};

/** Signal names Godot's own nodes have: never linked by name alone. */
const GENERIC_SIGNALS = new Set(`finished pressed timeout changed toggled text_changed value_changed
item_selected ready tree_exited tree_entered resized visibility_changed completed draw focus_entered
focus_exited mouse_entered mouse_exited gui_input animation_finished hidden confirmed canceled
close_requested text_submitted button_down button_up`.split(/\s+/));

/** Godot types that never carry a project script: nothing of the project is called on them. */
const PLAIN_TYPES = new Set(`int float bool String StringName NodePath Vector2 Vector2i Vector3 Vector3i
Vector4 Rect2 Rect2i Color Array Dictionary Transform2D Transform3D Basis Quaternion AABB Plane RID
PackedByteArray PackedInt32Array PackedInt64Array PackedFloat32Array PackedFloat64Array PackedStringArray
PackedVector2Array PackedVector3Array PackedColorArray Tween RandomNumberGenerator PackedScene Texture2D
Image FileAccess DirAccess JSON ConfigFile`.split(/\s+/));

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

/**
 * Replaces comments and string contents with nothing, keeping line breaks.
 * `inside`, when given, receives the (0-based) lines that start inside a string.
 */
function stripCode(src, inside) {
  let out = '';
  let i = 0;
  let line = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      i += quote.length;
      out += '""';
      while (i < src.length && !src.startsWith(quote, i)) {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') {
          out += '\n';
          line++;
          if (inside) inside.add(line);
        }
        i++;
      }
      i += quote.length;
    } else {
      if (c === '\n') line++;
      out += c;
      i++;
    }
  }
  return out;
}

/** Element type of `name: Array[Type]` (rest is what follows the name). */
function elementType(rest) {
  const m = rest.trim().match(/^:\s*Array\[\s*([A-Za-z_]\w*)\s*\]/);
  return m ? m[1] : null;
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

/** Tells whether the bracket opened at `open` closes on the last character of `text`. */
function closesAtEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if ('([{'.includes(text[i])) depth++;
    if (')]}'.includes(text[i]) && --depth === 0) return i === text.length - 1;
  }
  return false;
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
    memberTypes: {}, memberElements: {}, innerClasses: [], accessors: [], loads: [], text,
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

  // Declarations: the script's own (no indent) and those of its inner classes.
  const inside = new Set();
  const code = stripCode(text, inside).split(/\r?\n/);
  const deeper = (line, indent) => line.startsWith(indent) && /^\s/.test(line.slice(indent.length));
  /** Last line of the block under line `from`, whose owner is indented by `indent`. */
  const blockEnd = (from, indent) => {
    let last = from;
    for (let b = from + 1; b < lines.length; b++) {
      if (lines[b].trim() === '') continue;
      if (inside.has(b) || deeper(lines[b], indent)) { last = b; continue; }
      if ((code[b] || '').trim() === '') continue; // a comment further left does not end the block
      break;
    }
    return last;
  };

  let pending = [];
  let cls = null; // the inner class being read: { name, indent }
  for (let n = 0; n < lines.length; n++) {
    if (inside.has(n)) continue; // text of a multi-line string
    let l = lines[n];
    if (cls) {
      if (l.trim() === '') continue;
      if (/^\s/.test(l)) {
        if (cls.indent === null) cls.indent = l.match(/^\s+/)[0];
        if (!l.startsWith(cls.indent) || /^\s/.test(l.slice(cls.indent.length))) continue; // inside a function
        l = l.slice(cls.indent.length);
      } else cls = null;
    }
    const indent = cls ? cls.indent : '';
    const prefix = cls ? cls.name + '.' : '';
    let m;
    if (/^##/.test(l)) { pending.push(l.replace(/^##\s?/, '')); continue; }
    if (/^@\w+/.test(l) && !/\b(var|func)\b/.test(l)) continue; // lone annotation, keep the doc
    const doc = pending.join('\n').trim();
    pending = [];
    if ((m = l.match(/^signal\s+(\w+)\s*(\(.*\))?/))) {
      if (!cls) script.signals.push({ name: m[1], params: m[2] || '', doc, line: n + 1, emitters: [], listeners: [] });
      continue;
    }
    if (!cls && (m = l.match(/^class\s+(\w+)/))) {
      script.members.push({ name: m[1], kind: 'class', exported: false, decl: l.trim().replace(/:\s*$/, ''), doc, line: n + 1 });
      script.innerClasses.push(m[1]);
      cls = { name: m[1], indent: null };
      continue;
    }
    if ((m = l.match(/^((?:@\w+(?:\([^)]*\))?\s+)*)(static\s+)?(var|const)\s+(\w+)(.*)$/))) {
      if (!cls) {
        const type = declaredType(m[5]);
        if (type) script.memberTypes[m[4]] = type;
        const element = elementType(m[5]);
        if (element) script.memberElements[m[4]] = element;
      }
      let decl = l.trim().replace(/:\s*$/, '');
      if (cls) decl = decl.replace(new RegExp(`\\b${m[4]}\\b`), prefix + m[4]);
      if (/[\[({]\s*$/.test(decl)) decl += ' …';
      if (decl.length > 110) decl = decl.slice(0, 107) + '…';
      script.members.push({ name: prefix + m[4], kind: m[3], exported: /@export/.test(m[1]), decl, doc, line: n + 1 });
      // A property with its own set/get code: remember that code, it can call functions.
      const own = (code[n] || '').trim();
      const block = /:$/.test(own);
      if (block || /\b(set|get)\s*=/.test(own)) {
        const end = block ? blockEnd(n, indent) : n;
        const text = code.slice(block ? n + 1 : n, end + 1).join('\n');
        if (!cls && !/\bfunc\b/.test(own)) script.accessors.push({ name: m[4], code: text, set: /\bset\b/.test(text) });
        n = end;
      }
      continue;
    }
    if ((m = l.match(/^enum\s+(\w+)/))) {
      script.members.push({ name: prefix + m[1], kind: 'enum', exported: false, decl: l.trim().slice(0, 110), doc, line: n + 1 });
      continue;
    }
    if ((m = l.match(/^(static\s+)?func\s+(\w+)\s*\(/))) {
      // The signature can span several lines: read until the brackets close.
      let end = n;
      let depth = 0;
      let sig = '';
      for (; end < lines.length; end++) {
        const lineCode = code[end] || '';
        for (const c of lineCode) {
          if ('([{'.includes(c)) depth++;
          if (')]}'.includes(c)) depth--;
        }
        sig += (sig ? ' ' : '') + lines[end].trim();
        if (depth <= 0 && /:\s*$/.test(lineCode.trim())) break;
      }
      const bodyStart = end + 1;
      const last = blockEnd(end, indent);
      const src = lines.slice(n, last + 1).join('\n');
      const body = lines.slice(bodyStart, last + 1).join('\n');
      const bodyCode = code.slice(bodyStart, last + 1).join('\n');
      sig = sig.replace(/:\s*(#.*)?$/, '').replace(/\s+/g, ' ');
      const open = sig.indexOf('(');
      const close = sig.lastIndexOf(')');
      const localTypes = {};
      const localElements = {};
      const mixed = new Set(); // locals declared several times with different types
      const setLocal = (name, type) => {
        if (name in localTypes && localTypes[name] !== type) mixed.add(name);
        localTypes[name] = type;
      };
      for (const p of splitParams(sig.slice(open + 1, close))) {
        const pm = p.trim().match(/^(\w+)(.*)$/);
        if (pm) {
          const t = declaredType(pm[2]);
          if (t) setLocal(pm[1], t);
          const e = elementType(pm[2]);
          if (e) localElements[pm[1]] = e;
        }
      }
      for (const lm of body.matchAll(/\b(?:var|for)\s+(\w+)\s*(:=?[^\n]*)/g)) {
        const t = declaredType(lm[2].replace(/\s+in\s.*$/, ''));
        if (t) setLocal(lm[1], t);
        const e = elementType(lm[2]);
        if (e) localElements[lm[1]] = e;
      }
      // What untyped locals are made from, to work out their type later.
      const inits = {};
      for (const lm of bodyCode.matchAll(/\bvar\s+(\w+)\s*:=\s*([^\n]+)/g)) {
        if (lm[1] in inits && inits[lm[1]] !== lm[2].trim()) mixed.add(lm[1]);
        inits[lm[1]] = lm[2].trim();
      }
      for (const name of mixed) { delete localTypes[name]; delete inits[name]; }
      const loops = {};
      for (const lm of bodyCode.matchAll(/\bfor\s+(\w+)\s+in\s+([A-Za-z_][\w.]*)\s*:/g)) loops[lm[1]] = lm[2];
      const ret = sig.slice(close + 1).match(/->\s*(?:Array\[\s*([A-Za-z_]\w*)\s*\]|([A-Za-z_]\w*))/);
      script.funcs.push({
        name: prefix + m[2], short: m[2], inner: cls ? cls.name : null,
        sig, line: n + 1, doc, static: !!m[1], private: m[2].startsWith('_'),
        engine: ENGINE_CALLBACKS[m[2]] || '', src, body: bodyCode, localTypes, localElements, inits, loops,
        returns: ret ? ret[2] || null : null, returnsElement: ret ? ret[1] || null : null,
        hash: crypto.createHash('sha1').update(src.replace(/\s+$/gm, '')).digest('hex').slice(0, 10),
        calls: [], calledBy: [], handles: [], overrides: null, overriddenBy: [],
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
  /** `inner`: the inner class the caller is in, whose own functions come first. */
  const findFunc = (s, name, inner) => {
    if (inner) {
      const f = s.funcs.find((x) => x.inner === inner && x.short === name);
      if (f) return { s, f };
    }
    for (const c of chain(s)) {
      const f = c.funcs.find((x) => !x.inner && x.name === name);
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
  const memberElementTable = {};
  const innerClassNames = new Set();
  for (const s of scripts) {
    for (const f of s.funcs) (funcDefs[f.short] ||= []).push({ s, f });
    for (const g of s.signals) (signalDefs[g.name] ||= []).push({ s, g });
    for (const [name, type] of Object.entries(s.memberTypes)) (memberTypeTable[name] ||= new Set()).add(type);
    for (const [name, type] of Object.entries(s.memberElements)) (memberElementTable[name] ||= new Set()).add(type);
    for (const name of s.innerClasses) innerClassNames.add(name);
  }
  const only = (set) => (set && set.size === 1 ? [...set][0] : null);

  // A function that replaces its parent script's function of the same name.
  for (const s of scripts) {
    const parent = parentOf(s);
    if (!parent) continue;
    for (const f of s.funcs) {
      if (f.inner || f.engine) continue;
      const base = findFunc(parent, f.name);
      if (!base) continue;
      f.overrides = { s: base.s.path, f: base.f.name };
      base.f.overriddenBy.push({ s: s.path, f: f.name });
    }
  }
  /** The one place a function name is defined (its replacements in child scripts aside). */
  const uniqueDef = (name) => {
    const roots = (funcDefs[name] || []).filter((d) => !d.f.overrides);
    return roots.length === 1 ? roots[0] : null;
  };

  /** Marks a receiver known to be one of Godot's own types (so nothing of the project). */
  const ENGINE = { engine: true };

  /** Name of the type of `receiver` (a variable, class or autoload name), when it can be told. */
  const typeName = (s, f, receiver, chained, depth = 0) => {
    if (!chained) {
      if (f.localTypes[receiver]) return f.localTypes[receiver];
      if (depth < 4) {
        if (receiver in f.inits) {
          const t = typeOfExpr(s, f, f.inits[receiver], depth + 1);
          if (t) return t;
        }
        if (receiver in f.loops) {
          const t = elementOfExpr(s, f, f.loops[receiver], depth + 1);
          if (t) return t;
        }
      }
      if (!f.inner) {
        for (const c of chain(s)) if (c.memberTypes[receiver]) return c.memberTypes[receiver];
      }
    }
    if (named(receiver)) return receiver;
    // Last resort: a member of that name elsewhere, when it holds a project script.
    const elsewhere = only(memberTypeTable[receiver]);
    return elsewhere && named(elsewhere) ? elsewhere : null;
  };

  /** The project script an expression like `a.b.c` most likely is an instance of, or ENGINE. */
  const typeOfReceiver = (s, f, receiver, chained, depth = 0) => {
    if (receiver === 'self') return f.inner ? null : s;
    if (receiver === 'super') return f.inner ? null : parentOf(s);
    const t = typeName(s, f, receiver, chained, depth);
    if (!t) return null;
    if (named(t)) return named(t);
    return PLAIN_TYPES.has(t) && !innerClassNames.has(t) ? ENGINE : null;
  };

  /** The function `path.name(…)` reaches, when its owner can be told. */
  const resolveCall = (s, f, path, name, depth = 0) => {
    if (path.length === 0) return findFunc(s, name, f.inner);
    const owner = typeOfReceiver(s, f, path[path.length - 1], path.length > 1, depth);
    if (owner === ENGINE) return null;
    const found = owner ? findFunc(owner, name) : null;
    if (found) return found;
    return GENERIC.has(name) || ENGINE_CALLBACKS[name] ? null : uniqueDef(name);
  };

  /** Type name of a simple expression: `a.b`, `a.b(…)`, `X.new(…)`, `… as X`. */
  function typeOfExpr(s, f, expr, depth) {
    let m;
    if ((m = expr.match(/\bas\s+([A-Za-z_]\w*)$/))) return m[1];
    if ((m = expr.match(/^([A-Z]\w*)\.new\(/))) return m[1];
    if ((m = expr.match(/^((?:[A-Za-z_]\w*\.)*)([A-Za-z_]\w*)$/))) {
      const path = m[1] ? m[1].slice(0, -1).split('.') : [];
      if (path.length === 0) return typeName(s, f, m[2], false, depth);
      const owner = typeOfReceiver(s, f, path[path.length - 1], path.length > 1, depth);
      if (owner === ENGINE) return null;
      if (owner) {
        for (const c of chain(owner)) if (c.memberTypes[m[2]]) return c.memberTypes[m[2]];
        return null;
      }
      return only(memberTypeTable[m[2]]);
    }
    if ((m = expr.match(/^((?:[A-Za-z_]\w*\.)*)([A-Za-z_]\w*)\(/)) && closesAtEnd(expr, m[0].length - 1)) {
      const target = resolveCall(s, f, m[1] ? m[1].slice(0, -1).split('.') : [], m[2], depth);
      return target ? target.f.returns : null;
    }
    return null;
  }

  /** Type name of the elements of `a.b` (a typed array). */
  function elementOfExpr(s, f, expr, depth) {
    const path = expr.split('.');
    const name = path.pop();
    if (path.length === 0) {
      if (f.localElements[name]) return f.localElements[name];
      if (!f.inner) for (const c of chain(s)) if (c.memberElements[name]) return c.memberElements[name];
    } else {
      const owner = typeOfReceiver(s, f, path[path.length - 1], path.length > 1, depth);
      if (owner && owner !== ENGINE) {
        for (const c of chain(owner)) if (c.memberElements[name]) return c.memberElements[name];
      }
    }
    return only(memberElementTable[name]);
  }

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
          const target = findFunc(s, name, f.inner);
          if (target) addCall(s, f, target, false);
          continue;
        }
        if (name === 'new' || name === 'emit' || name === 'connect') continue;
        const rm = before.match(/(\.)?\s*([A-Za-z_]\w*)\.$/);
        let target = null;
        let guess = false;
        let plain = false; // the receiver is one of Godot's plain types: no matching by name
        if (rm) {
          const owner = typeOfReceiver(s, f, rm[2], !!rm[1]);
          if (owner === ENGINE) plain = true;
          else if (owner) target = findFunc(owner, name);
        } else {
          // `things[i].name(…)`: the receiver is one element of a typed array.
          const im = before.match(/([A-Za-z_][\w.]*)\[[^\[\]]*\]\.$/);
          const element = im ? elementOfExpr(s, f, im[1], 0) : null;
          if (element && named(element)) target = findFunc(named(element), name);
        }
        if (!target && !plain &&!GENERIC.has(name) && !ENGINE_CALLBACKS[name]) {
          target = uniqueDef(name);
          guess = true;
        }
        if (target) addCall(s, f, target, guess);
      }
      // Own functions passed around by name (signal handlers, callables).
      for (const c of chain(s)) {
        for (const other of c.funcs) {
          if (other === f || other.inner || ENGINE_CALLBACKS[other.name]) continue;
          const re = new RegExp(`(?<![\\w.])${other.name}\\b(?!\\s*\\()`);
          if (re.test(body) && !(other.name in f.localTypes)) addCall(s, f, { s: c, f: other }, false);
        }
      }
      // Another script's function passed around by name (`Settings.set_volume`).
      for (const m of body.matchAll(/(?<![\w.])([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b(?!\s*\()/g)) {
        if (!funcDefs[m[2]]) continue;
        const owner = typeOfReceiver(s, f, m[1], false);
        const target = owner && owner !== ENGINE ? findFunc(owner, m[2]) : null;
        if (target) addCall(s, f, target, false);
      }
      // Functions named in a string (`&"on_board_start"`, `call("name")`): by name only.
      for (const m of f.src.matchAll(/&"([A-Za-z_]\w*)"|\b(?:call|call_deferred|callv|has_method|Callable)\(\s*(?:[\w.]+\s*,\s*)?"([A-Za-z_]\w*)"/g)) {
        const name = m[1] || m[2];
        if (GENERIC.has(name) || ENGINE_CALLBACKS[name]) continue;
        const target = findFunc(s, name, f.inner) || uniqueDef(name);
        if (target) addCall(s, f, target, true);
      }
      // Signals: emitted here, connected here to a handler, or waited for here.
      const resolveSignal = (expr) => {
        const parts = expr.split('.');
        const name = parts.pop();
        if (parts.length === 0) return f.inner ? null : findSignal(s, name);
        const owner = typeOfReceiver(s, f, parts[parts.length - 1], parts.length > 1);
        if (owner === ENGINE) return null;
        if (owner) {
          const found = findSignal(owner, name);
          if (found) return found;
        }
        if (GENERIC_SIGNALS.has(name)) return null;
        return signalDefs[name]?.length === 1 ? signalDefs[name][0] : null;
      };
      const hears = (found, listener) => {
        if (!found.g.listeners.some((e) => e.s === listener.s && e.f === listener.f)) found.g.listeners.push(listener);
        if (found.s !== s) uses.get(s).add(found.s);
      };
      for (const m of body.matchAll(/([A-Za-z_][\w.]*)\.emit\b/g)) {
        const found = resolveSignal(m[1]);
        if (found && !found.g.emitters.some((e) => e.s === s.path && e.f === f.name)) {
          found.g.emitters.push({ s: s.path, f: f.name });
          if (found.s !== s) uses.get(s).add(found.s);
        }
      }
      for (const m of body.matchAll(/([A-Za-z_][\w.]*)\.connect\s*\(\s*([A-Za-z_][\w.]*)?/g)) {
        // The handler: a function's name (maybe with .bind), or code written in place.
        const what = (m[2] || '').replace(/\.(bind|unbind|call_deferred)$/, '');
        let handler = null;
        if (what && what !== 'func' && !what.endsWith('.emit')) {
          const path = what.split('.');
          const name = path.pop();
          if (path.length === 0 || (path.length === 1 && path[0] === 'self')) handler = findFunc(s, name, f.inner);
          else {
            const owner = typeOfReceiver(s, f, path[path.length - 1], path.length > 1);
            if (owner && owner !== ENGINE) handler = findFunc(owner, name);
          }
        }
        if (handler && !handler.f.handles.includes(m[1])) handler.f.handles.push(m[1]);
        const found = resolveSignal(m[1]);
        if (found) hears(found, handler ? { s: handler.s.path, f: handler.f.name } : { s: s.path, f: f.name });
      }
      for (const m of body.matchAll(/\bawait\s+([A-Za-z_][\w.]*)(?![\w.]*\s*\()/g)) {
        const found = resolveSignal(m[1]);
        if (found) hears(found, { s: s.path, f: f.name });
      }
    }

    // Functions a property's set/get code runs.
    for (const a of s.accessors) {
      for (const c of chain(s)) {
        for (const other of c.funcs) {
          if (other.inner || ENGINE_CALLBACKS[other.name]) continue;
          if (new RegExp(`(?<![\\w.])${other.name}\\b`).test(a.code)) other.handles.push(`${a.name} (when ${a.set ? 'set' : 'read'})`);
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
      // The script the file is made of, and those of the parts it holds.
      const owners = new Set(attached);
      if (cm && byClass[cm[1]]) owners.add(byClass[cm[1]]);
      const dir = path.posix.dirname(file);
      for (const owner of owners) owner.data[dir] = (owner.data[dir] || 0) + 1;
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
          overrides: f.overrides, overriddenBy: f.overriddenBy,
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
