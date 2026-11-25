# Atelier

Gabriel's gamedev workshop: the tools, skills and starter pieces shared by all his
games (Pierresavant, Love Will Find, Philosopher's Paradise, and the next ones).
Nothing here is a game. A tool earns its place when it has been useful on two projects.

## What's inside

| Folder | What it is |
|---|---|
| `tools/atlas/` | **Code Atlas**: turns a Godot project's code into one browsable page (map of the folders, every script and function explained, who calls whom, signals) |
| `tools/checklist/` | **Game essentials checklist**: the systems almost every game needs (title menu, save, options, language, debug panel, and so on) and whether a project has each one |
| `skills/` | Claude skills that drive the tools (`/atlas`, `/checklist`); the source of truth, copied to `~/.claude/skills/` |

## Code Atlas

Needs Node 18+. From anywhere:

```
node tools/atlas/atlas.mjs <project folder>              # writes <project>/docs/atlas/index.html
node tools/atlas/atlas.mjs <project folder> --stats      # how many explanations are missing or outdated
node tools/atlas/atlas.mjs <project folder> --todo       # the functions to explain, as JSON
node tools/atlas/atlas.mjs <project folder> --apply f.json   # merge explanations ({ "path.gd": { "func": "text" } })
```

The structure (functions, calls, signals, scenes, data files) is read from the code on
every build, so it is always current. The plain-language explanations are written by
Claude and kept in `<project>/docs/atlas/explanations.json`, each stamped with a hash of
the function's code: when a function changes, its explanation shows as outdated until
`/atlas` rewrites it. In a Claude session inside a game project, type `/atlas`.

Links between functions are found by reading the code, not by running it: a dashed chip
means "matched by name only", and "no caller found" is a hint, not a proof.

## Game essentials checklist

Needs Node 18+. From anywhere:

```
node tools/checklist/checklist.mjs <project folder>      # writes <project>/docs/checklist/checklist.md
```

The list is in `tools/checklist/essentials.mjs`: about 35 systems, in eight groups (start
and menus, saving, settings, language, debug, information and feedback, sound, making and
shipping). Each one is looked for in the game's scripts and scenes, and the report says
"There", "Check" (only a file name matches) or "Missing", with the files it found.

To say an item is not needed for a game, add it to `<project>/docs/checklist/decisions.json`
with a reason, e.g. `{ "language-picker": "English only" }`. In a Claude session inside a
game project, type `/checklist`.

It reads words, not behaviour: "There" means the code mentions the system, so check the
evidence. Tests and tools are only checked by file name.
