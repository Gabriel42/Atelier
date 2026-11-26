# Atelier

Gabriel's gamedev workshop: the tools, skills and starter pieces shared by all his
games (Pierresavant, Love Will Find, Philosopher's Paradise, and the next ones).
Nothing here is a game. A tool earns its place when it has been useful on two projects.

## What's inside

| Folder | What it is |
|---|---|
| `atelier.cmd`, `tools/menu/` | **Main menu**: one place to run every tool below on a game |
| `tools/atlas/` | **Code Atlas**: turns a Godot project's code into one browsable page (map of the folders, every script and function explained, who calls whom, signals) |
| `tools/checklist/` | **Game essentials checklist**: the systems almost every game needs (title menu, save, options, language, debug panel, and so on) and whether a project has each one |
| `tools/library/` | **Library visualizer**: a page to browse the asset library: image thumbnails, sounds that play in place, fonts as sample text, 3D models you can turn, with search, filters and each pack's licence |
| `tools/itch/` | **itch.io exporter**: builds a game and uploads it to its itch.io page in one command |
| `skills/` | Claude skills that drive the tools (`/atlas`, `/checklist`, `/itch`); the source of truth, copied to `~/.claude/skills/` |
| `library/` | **Asset library**: art, sound, fonts and 3D files, sorted by type, each with its license, plus whole packs in `library/packs/`. Only its notes and folder layout go to GitHub; git ignores the assets. `library/sources.md` lists the free repositories to get more |

## Main menu

Needs Node 18+. Double-click `atelier.cmd`, or from the Atelier folder:

```
node tools/menu/menu.mjs                    # pick a game, then a tool
node tools/menu/menu.mjs <project folder>   # start on that game
```

It lists the Godot games in the folder that holds Atelier (Pierresavant, Love Will Find,
Philosopher's Paradise...). Pick one, then: Code Atlas (builds it and opens it), Essentials
checklist (runs it and offers to open the report), itch.io (what is ready, build only, or
build and upload, which asks first) or Asset library. Up/Down and Enter to choose (or the
number), Esc to go back, Q to quit. Ctrl+C stops a running tool and comes back to the menu.

## Library visualizer

Needs Node 18+. From the Atelier folder:

```
node tools/library/library.mjs library             # build the page and open it in the browser
node tools/library/library.mjs library --build     # build the page only
```

It reads every image, sound, font and 3D model in `library/` (skipping `Downloaded/`),
and writes `library/index.html`, which git ignores because it shows the assets. The page
opens at http://localhost:4321 (a small server on this computer only; Ctrl+C stops it).
Copies of one asset in several formats (glb, obj, fbx...; ogg, wav) show as one card.

On the page: search names and folders, filter by type, pick a pack on the left and walk
its folders, change the background behind images. Click a card for a big preview, the
file's path (Copy), its formats and the pack's licence with its credit line; the arrow
keys go to the next and previous asset. Packs that need credit show a "Credit" badge,
packs whose licence is not read yet a "Check licence" badge. 3D models show in their
plain colours (glb, gltf and obj; fbx-only models have no preview).

**Your tags**: open an asset and type a tag in "Your tags" (Enter; commas add several),
or Ctrl+click cards (Shift+click for a run of them) to tag many at once from the bar that
appears. Tags show on the cards, are listed on the left (click one to see only those
assets) and are found by the search. They are saved in `library/tags.json`, so they stay
on this computer like the assets. Changing tags needs the page opened through the tool.

## itch.io exporter

Needs Node 18+, Godot with its export templates, and butler (itch.io's uploader).

```
node tools/itch/itch.mjs <project folder>               # build, then upload to itch.io
node tools/itch/itch.mjs <project folder> --dry-run     # build only, upload nothing
node tools/itch/itch.mjs <project folder> --check       # what is ready, what is missing
node tools/itch/itch.mjs <project folder> --page https://you.itch.io/your-game   # set the page (once)
node tools/itch/itch.mjs <project folder> --only web    # one build only (web, windows, linux, mac)
```

It uses the export presets the game already has (Web and Windows unless told otherwise),
builds them fresh into `<project>/build/itch/` and uploads each one, tagged with the
version from `project.godot`. In a Claude session inside a game project, type `/itch`.

To do once per computer: put butler in `C:\Users\gabri\butler\` (from
https://itchio.itch.io/butler) and run `butler login`. To do once per game: create the
page on itch.io, give it to the tool with `--page` (kept in `<project>/itch.json`), and
after the first Web upload, on the page's "Edit game" screen, set "Kind of project" to
HTML and tick "This file will be played in the browser" next to the html5 file.

It finds Godot in `C:\Users\gabri\Godot\` (the version the project uses); set `GODOT` or
`BUTLER` to use another copy.

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
