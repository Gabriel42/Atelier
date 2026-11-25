---
name: itch
description: Build the current Godot game and upload it to its itch.io page (Web and Windows builds, tagged with the game's version). Use when Gabriel types /itch or asks to export, upload, publish or push the game to itch.io.
---

# itch.io exporter

The tool is `C:\Users\gabri\OneDrive\Documents\Atelier\tools\itch\itch.mjs` (Node, no
dependencies). Run it on the current project's root (the folder with `project.godot`).
Below, `ITCH` stands for `node "C:\Users\gabri\OneDrive\Documents\Atelier\tools\itch\itch.mjs"`.

## Steps

1. `ITCH . --check`. If a line says MISSING, fix it with Gabriel before going on:
   - no page: ask him for the game's itch.io address, then `ITCH . --page <address>`.
     The page must already exist on itch.io (he creates it once, as a draft is fine).
   - not connected: he runs `butler login` himself and clicks "Authorize" in the browser.
   - butler not found: ask before downloading it; it goes in `C:\Users\gabri\butler\`.
2. Tell Gabriel the game, the version and the page, and upload only when he has asked for
   the upload in this conversation: an upload replaces what players get. If the version
   is the same as the last upload, say so (he may want to bump it first; follow the
   project's own rule for bumping).
3. `ITCH .` builds into `build/itch/` and uploads. Run it in the background: the two
   builds and the upload take a few minutes. `ITCH . --dry-run` builds without uploading.
4. Report what was uploaded and the page address. After the first Web upload of a game,
   remind him of the one thing only he can do: on the page's "Edit game" screen, set
   "Kind of project" to HTML and tick "This file will be played in the browser" next to
   the html5 file.

`--only web` or `--only windows` limits the builds; `"builds": ["web", "windows", "linux"]`
in the project's `itch.json` changes the default for that game.
