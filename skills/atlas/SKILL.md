---
name: atlas
description: Build or refresh the Code Atlas of the current Godot project, a browsable HTML page that maps the code and explains every script and function in plain language. Use when Gabriel types /atlas or asks to update, rebuild or open the code atlas.
---

# Code Atlas

The generator is `C:\Users\gabri\OneDrive\Documents\Atelier\tools\atlas\atlas.mjs` (Node,
no dependencies). Run it on the current project's root (the folder with `project.godot`).
Below, `ATLAS` stands for `node "C:\Users\gabri\OneDrive\Documents\Atelier\tools\atlas\atlas.mjs"`.

## Steps

1. `ATLAS . --stats` to see how many explanations are missing or outdated.
2. If some are, get them with `ATLAS . --todo > <scratchpad>/atlas_todo.json` (add a
   path prefix after `--todo` to take one folder at a time; tests are skipped unless the
   prefix is `tests`). Each entry has the function's code, its `##` comment and, when
   outdated, the previous explanation.
3. Write the explanations (rules below) to a JSON file in the scratchpad, shaped
   `{ "path/from/root.gd": { "function_name": "explanation" } }`, then
   `ATLAS . --apply <that file>`. For more than about 80 functions, split by folder and
   give each part to a subagent with the rules below, then apply each file.
4. `ATLAS .` to build `docs/atlas/index.html`, and tell Gabriel where it is.

Never edit `docs/atlas/explanations.json` by hand: `--apply` stamps each explanation with
the hash of the code it describes, which is how outdated ones are found.

## How to write an explanation

- The reader is the game's designer: he knows the game, he does not want to read the code.
- 1 to 3 short sentences of plain English: what it does in the game's terms and, when
  the code shows it, when or why it is used. Mention a surprising rule or edge case.
- Start with a verb ("Puts…", "Tells whether…"). Do not restate the signature.
- Use the project's own words (its terminology table, if it has one). Code names in
  backticks; no other markdown, no line breaks.
- Read the function body; never guess from the name.
