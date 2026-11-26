# TODO

## Now
- **Atlas on Love Will Find**: run it there; fix whatever the parser misses on a second codebase.
- **Checklist: tune the list**: go through each game's report with Gabriel, mark the items a game does not need in `decisions.json`, and fix the patterns that give wrong "There" or "Missing" answers. Two known gaps: a game's own title-screen code can count as "Quit to menu"; "Options menu" needs a closer look on Pierresavant.

## For Gabriel
- **Download these asset packs** from the itch.io Bundle for Racial Justice and Equality (itch.io → My purchases → Bundles). Read each pack's licence on its page before using it in a game; only Kenney's is known (CC0: free to use, no credit needed).
  - Both games:
    - [x] [Kenney Game Assets 1](https://kenney.itch.io/kenney-game-assets-1): interface sounds, impact sounds, jingles, fonts, UI pieces
    - [x] [Cassette](https://shapeforms.itch.io/cassette) (Shapeforms): tape clicks and clunks for menu sounds
    - [x] [Mini Loops](https://yadu.itch.io/mini-loops): 5-second music loops for short stingers
    - [x] [Transitions - Godot Asset](https://in3mo.itch.io/transitions-godot): scene transition shaders (may be made for Godot 3)
  - Love Will Find:
    - [x] [HPS Cartography Kit](https://natetreme.itch.io/cartographykit): hand-drawn hex tiles for the board
    - [x] [Kawaii Game Icons](https://roboxel.itch.io/kawaii-game-icons): 50 cute icons for objects or gifts
  - Pierresavant:
    - [x] [Classic JRPG Music Pack](https://richarrest.itch.io/classic-jrpg-music-pack-medium-pack): background music
    - [x] [RPG Items - Retro Pack](https://blodyavenger.itch.io/rpg-items-retro-pack): pixel item icons, as reference for new items
    - [x] [Pixel Fantasy RPG Icons](https://cazwolf.itch.io/caz-pixel-1): pixel icons, as reference
  - All the itch.io packs above are unzipped in `library/packs/`, each with a licence note.
- **Read the Pixel Fantasy RPG Icons EULA** (the Google Doc linked in `library/packs/pixel-fantasy-rpg-icons/EULA - READ ME.txt`) and update its licence note before using those icons.
  - Humble Bundle (humblebundle.com → Library), contents not looked at yet:
    - [ ] Humble Software Bundle: Unity Fantasy Games & Game Dev Assets
    - [ ] Humble Weekly Bundle: RPG Maker (its packs may be allowed in RPG Maker only)

## Next
- **Library visualizer**: a page to browse `library/`: image thumbnails in a grid, sounds you can play in place, fonts shown as sample text, 3D models as a preview, with search and a filter by pack and type. Each asset shows its pack's licence (and a "credit needed" badge). The tool is tracked in git, but the page it builds stays inside `library/` (ignored), because it shows the assets.
- **`/release`**: one command for a game: run all tests, bump the version, draft patch notes from `done.md`, then call the itch.io exporter (`tools/itch/`).
- **Content and balance dashboard**: a page that reads a game's `.tres` files and CSVs: recipe graph, unlock chain, items nothing drops or uses, a pacing simulation.
- **Screenshot gallery**: keep each commit's screenshots and show before/after with a slider.

## Later
- **Godot starter**: the reusable half of Pierresavant (working files, settings, pause menu, debug panel, theme, FX layer, tooltip, version and patch notes, test setup, export presets) as a template. Extract it when game 3 starts.
- Atlas: show scene trees (`.tscn` nodes) next to their script.
- Atlas: a "what changed since last time" view (new, changed and removed functions).
- Atlas: a nicer folder map when most folders sit in one column.
- Atlas: a review mode. While writing each explanation, Claude also notes likely bugs, dead code or copy-pasted logic; the page lists them by script, and they go outdated with the code like explanations do.
- Atlas: a "not tested" view: the game functions no test calls, by script, with a count per folder (built from the existing "Tested in" links).

## Ideas (not decided)
- A playtest bot that plays a game headless at high speed and reports the pacing curve.
