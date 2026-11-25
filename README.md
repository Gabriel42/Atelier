# Atelier

Gabriel's gamedev workshop: the tools, skills and starter pieces shared by all his
games (Pierresavant, Love Will Find, Philosopher's Paradise, and the next ones).
Nothing here is a game. A tool earns its place when it has been useful on two projects.

## What's inside

| Folder | What it is |
|---|---|
| `tools/atlas/` | **Code Atlas**: turns a Godot project's code into one browsable page (map of the folders, every script and function explained, who calls whom, signals) |
| `skills/` | Claude skills that drive the tools (`/atlas`); the source of truth, copied to `~/.claude/skills/` |
| `library/` | **Asset library**: art, sound, fonts and 3D files, sorted by type, each with its license. `library/sources.md` lists the free repositories to get more |

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

What it follows: calls (also through typed variables, typed arrays and what a function
returns), functions passed by name or named in a string (`&"on_board_start"`), signals
(sent, connected, waited for with `await`), a property's `set` code, functions of inner
classes, and a script's own version of a function of the script it extends ("Own version
of" / "Other versions"). Scripts used by data files (`.tres`) show which folders use them.
