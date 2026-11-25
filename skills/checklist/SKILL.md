---
name: checklist
description: Check the current game against Gabriel's list of essentials (save, options, pause menu, debug panel, language, and so on) and write a report of what is there and what is missing. Use when Gabriel types /checklist or asks what a game still needs, what is missing, or to run the essentials checklist.
---

# Game essentials checklist

The tool is `C:\Users\gabri\OneDrive\Documents\Atelier\tools\checklist\checklist.mjs`
(Node, no dependencies). The list of essentials it checks is in
`tools\checklist\essentials.mjs`. Run it on the current project's root (the folder with
`project.godot`). Below, `CHECK` stands for
`node "C:\Users\gabri\OneDrive\Documents\Atelier\tools\checklist\checklist.mjs"`.

## Steps

1. `CHECK .` to write `docs/checklist/checklist.md` and print the summary.
2. Read `docs/checklist/checklist.md`. For each item marked "There", open one of its
   listed files if it is not obvious that the match is the real feature (a word such as
   "new game" can show up in a file that does not start a game). Correct your reading
   of it, not the report.
3. For each "Check" item, look at the file it names and decide. Do not tell Gabriel
   it is there until you have seen it.
4. Tell Gabriel, in short plain English: how many items are there, and the missing
   ones with one line each. Ask him which missing items this game does not need. Do not
   write the answer into `decisions.json` yourself; wait for his reply, then add each
   one as `"item-id": "reason"` (the ids are in `essentials.mjs`).
5. Run `CHECK .` again after any change, so the report is current, and tell Gabriel
   where the report is.

## Rules

- The report is a starting point. The tool reads words in the code; it cannot play the
  game, so "There" means "the code mentions it", not "it works".
- Plain English for Gabriel: no tool names or regexes in what you say to him.
- Do not change the game's code to make an item show as there.
- If the list itself needs an item added or reworded, edit `essentials.mjs` in the
  Atelier folder, not in the game.
