# Asset library

A shared stock of art, sound and fonts that any of Gabriel's games can use.
Files go in the folder that matches what they are. Sort the details later.

**The assets stay on this computer.** Git tracks only the library's framework (this
README, `sources.md`, the folder layout, and its tools); every asset, pack, licence note
and download is ignored, so none of it goes to GitHub. Several pack licences forbid
sharing the raw files. Copy an asset into a game's project only when the game uses it.

## Packs

Whole packs, unzipped as they came, in `packs/`. Each has a licence note next to it
(`packs/<pack>.license.txt`). The original downloads are in `Downloaded/`.

| Pack | What's in it | Good for | Licence |
|---|---|---|---|
| `kenney-game-assets-1` | Huge: 60+ 2D packs (UI, icons, tiles, characters, board games, hex), 3D kits, 10 sound packs (UI, foley, jingles, RPG, retro, music loops), Kenney fonts | Both games | CC0, no credit |
| `cassette` | Tape clicks, clunks, rewinds, start and stop sounds (WAV) | Menu sounds | Free, no credit; only inside a game, never share the files |
| `mini-loops` | 50 short music loops, 2 discs (OGG and WAV) | Stingers, short jingles | Free, no credit; only inside a game, never share the files |
| `transitions-godot` | Scene transition shaders (cutoff, fade, pixelation) | Scene changes | MIT. Made for Godot 3, needs porting |
| `hps-cartography-kit` | Hand-drawn hex tiles: terrain, trees, rivers, roads, towns, map icons | Love Will Find board | **Credit needed**; never share the tiles |
| `kawaii-game-icons` | 250 cute icons, with and without background (32 to 256 px) | Love Will Find objects and gifts | Free, no credit |
| `classic-jrpg-music` | JRPG tracks (menu, town, dungeon, travel, battle, boss) and stingers (MP3 and OGG) | Pierresavant music | **CC BY-SA, credit needed** |
| `rpg-items-retro` | Pixel item icons: weapons, armour, potions, food, crafting | Pierresavant item reference | Free, no credit; never share the icons |
| `pixel-fantasy-rpg-icons` | 87 pixel RPG icons at 16, 24 and 32 px | Pierresavant reference | **EULA not read yet**: check before use |

When a game uses a pack that needs credit, add the credit line from its licence note to
the game's credits.

## Folders

| Folder | What goes in it |
|---|---|
| `sprites/` | 2D characters, objects, creatures (single images or sheets) |
| `tiles/` | Tilesets and tile maps |
| `ui/` | Buttons, panels, frames, cursors |
| `icons/` | Small icons |
| `audio-music/` | Music loops and tracks |
| `audio-sfx/` | Sound effects |
| `fonts/` | Font files |
| `3d-models/` | 3D models (.glb, .gltf, .fbx) |
| `textures/` | Materials, ground and wall textures |

## Adding an asset

1. Put the file in the matching folder.
2. Keep the license next to it: a file named `<asset>.license.txt` with where it came
   from, the author, the license name and the link. No license note, no use.
3. Only add assets whose license allows use in your games (commercial use and no
   credit needed is the easiest; if credit is needed, the note must say so).

Where the files came from is listed in [sources.md](sources.md).
