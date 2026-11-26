# CLAUDE.md

How we work on **Atelier**, Gabriel's gamedev workshop: tools, skills and starter
pieces shared by his games. See `README.md` for what each tool does.

## Working files

| File | What it's for |
|---|---|
| `README.md` | What each tool is and how to run it; update it when a tool changes |
| `TODO.md` | Tool ideas and improvements, by priority |
| `friction.md` | Gabriel's log of what slowed him down on a game; the source of new tools |

## Workflow
- Always talk to Gabriel in English here, even when he writes in French.
- Start working right away on what Gabriel asks; ask only when his input is needed.
- A tool is done when it has been run on a real project (Pierresavant at
  `../Pierresavant`, Love Will Find at `../Love Will Find`) and its result checked.
- Commit only when asked.

## Rules for tools
- A tool takes the project folder as an argument and never assumes Pierresavant.
- No dependencies to install: plain Node (18+) scripts or headless Godot scripts.
- A tool writes only inside the project it is run on (e.g. `docs/atlas/`), never elsewhere.
- Text shown to Gabriel is in plain English, short, no jargon.
- A skill in `skills/<name>/SKILL.md` is the source of truth; after changing it, copy it
  to `C:\Users\gabri\.claude\skills\<name>\SKILL.md`.

## Layout
- `tools/menu/menu.mjs` – the main menu: fills `tools/menu/page.html` with the games,
  writes `build/menu/index.html` (to upload) and serves it on localhost:4310, where its
  buttons run the tools; `atelier.cmd` starts it with a double-click
- `tools/atlas/atlas.mjs` – the Code Atlas generator (parses GDScript, links calls and
  signals, merges explanations); `tools/atlas/page.html` – the page it fills in (one
  self-contained file: styles, script, data)
- `tools/itch/itch.mjs` – the itch.io exporter (builds the game's export presets with
  headless Godot into `build/itch/`, uploads with butler; the page is in the game's `itch.json`)
- `tools/library/library.mjs` – the library visualizer (scans `library/`, writes
  `library/index.html` from `tools/library/page.html`, serves it on localhost:4321)
- `skills/atlas/SKILL.md` – the `/atlas` skill; `skills/itch/SKILL.md` – the `/itch` skill
