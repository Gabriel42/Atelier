// The game essentials: systems and features that almost every game of Gabriel's
// needs. Edit this list to add, drop or reword an item. Each item says how the
// checklist tool looks for it:
//   file: patterns tested against a file's path inside the project
//   text: patterns tested against the text of the game's scripts and scenes
//         (.gd, .tscn, project.godot; not translation or data files)
//   proof: true when a file name alone is enough to say "there"
// A text match means "there"; a file-name match alone means "check it by hand"
// unless the item has proof: true.

export const GROUPS = [
  'Start and menus',
  'Saving',
  'Settings',
  'Language',
  'Debug',
  'Information and feedback',
  'Sound',
  'Making and shipping',
];

export const ESSENTIALS = [
  // Start and menus
  { id: 'title-screen', group: 'Start and menus', name: 'Title / main menu',
    why: 'The first screen: start a game, continue, open options, quit.',
    file: [/menu|title/i], text: [/new_?game|start_game|continue_game/i] },
  { id: 'pause-menu', group: 'Start and menus', name: 'Pause menu',
    why: 'Stops the game and gives a way to resume, change options or leave.',
    file: [/pause/i], text: [/\bpaused\b|set_paused/i] },
  { id: 'quit-to-menu', group: 'Start and menus', name: 'Quit to menu',
    why: 'Lets the player leave a game in progress and go back to the title screen.',
    file: [], text: [/(quit|exit|back|return|go|goto)_?(to_)?(main_)?menu|change_(level|scene)\(\s*\w*MENU\b/i] },
  { id: 'quit-game', group: 'Start and menus', name: 'Quit the game',
    why: 'A clear way to close the game, and it should still save on the way out.',
    file: [], text: [/get_tree\(\)\.quit|NOTIFICATION_WM_CLOSE|quit_game|exit_game/i] },
  { id: 'reset-game', group: 'Start and menus', name: 'Start over / reset the game',
    why: 'Wipes progress so the player can begin again from nothing.',
    file: [], text: [/new_?game|new_run|restart_(run|game)|reset_(game|run|progress|save)|start_over|erase_save|delete_save|clear_save|wipe_save/i] },
  { id: 'confirm-dialog', group: 'Start and menus', name: 'Asks before losing progress',
    why: 'Quitting or resetting asks "are you sure?" so a click does not wipe hours of play.',
    file: [/confirm/i], text: [/ConfirmationDialog|confirm_(dialog|quit|reset|delete)/i] },

  // Saving
  { id: 'save-system', group: 'Saving', name: 'Save system',
    why: 'Writes progress to disk so it survives closing the game.',
    file: [/save/i], text: [/FileAccess\.open|ConfigFile|store_var|store_string|JSON\.stringify|user:\/\//i] },
  { id: 'load-continue', group: 'Saving', name: 'Load and continue',
    why: 'Reads the save back and lets the player pick up where they left off.',
    file: [], text: [/load_(game|save)|read_save|continue_(game|run)|has_save|save_exists/i] },
  { id: 'autosave', group: 'Saving', name: 'Autosave',
    why: 'Saves by itself at sensible moments, so the player never has to remember.',
    file: [], text: [/auto_?save|save_on_(quit|exit|close)|save_now/i] },
  { id: 'save-safety', group: 'Saving', name: 'Safe saving (temp file or backup, version number)',
    why: 'A crash during a save must not destroy the previous save.',
    file: [], text: [/\.tmp\b|\.bak\b|temp_save|backup|save_version|SAVE_VERSION|migrat/i] },
  { id: 'broken-save', group: 'Saving', name: 'Copes with a broken or old save',
    why: 'A damaged or outdated save should give a message or a fresh start, not a crash.',
    file: [], text: [/corrupt|broken_save|invalid_save|bad_save|JSON\.parse/i] },

  // Settings
  { id: 'options-menu', group: 'Settings', name: 'Options menu',
    why: 'One place for every player setting.',
    file: [/option|setting/i], text: [/options?_(menu|panel|screen)|settings_(menu|panel|screen)/i] },
  { id: 'volume', group: 'Settings', name: 'Volume sliders',
    why: 'Music and sound effects can be turned up or down.',
    file: [], text: [/linear_to_db|set_bus_volume|bus_volume|volume_db|volume_linear/i] },
  { id: 'display', group: 'Settings', name: 'Fullscreen and resolution',
    why: 'Players choose windowed or fullscreen and the screen size.',
    file: [], text: [/fullscreen|window_set_mode|WINDOW_MODE|window_size|resolution|vsync/i] },
  { id: 'remap-keys', group: 'Settings', name: 'Remap the controls',
    why: 'Players can change which key does what.',
    file: [], text: [/action_erase_events|action_add_event|rebind|remap/i] },
  { id: 'settings-kept', group: 'Settings', name: 'Settings kept between sessions',
    why: 'Options are written to disk, so they are still set next time the game opens.',
    file: [], text: [/ConfigFile|save_settings|store_settings|settings.*store_var/i] },
  { id: 'reset-settings', group: 'Settings', name: 'Reset settings to default',
    why: 'A way back to the original options after experimenting.',
    file: [], text: [/reset_(settings|to_default|defaults?)|restore_defaults?|default_settings/i] },
  { id: 'accessibility', group: 'Settings', name: 'Accessibility options',
    why: 'Text size, colour-blind mode, less screen shake or flashing.',
    file: [], text: [/colou?r_?blind|screen_?shake|reduce_(motion|flash)|text_scale|font_scale|high_?contrast/i] },
  { id: 'controller', group: 'Settings', name: 'Controller (gamepad) support',
    why: 'Players can use a gamepad, and the game shows the right button icons.',
    file: [], text: [/gamepad|JoypadButton|InputEventJoypad|JOY_BUTTON/i] },

  // Language
  { id: 'translatable-text', group: 'Language', name: 'Text can be translated',
    why: 'All text goes through a translation call, so adding a language later is easy.',
    file: [/lang|locali[sz]|translat/i], text: [/\btr\(|TranslationServer/i] },
  { id: 'translation-files', group: 'Language', name: 'Translation files',
    why: 'The translated text lives in files (.po, .csv or .translation) next to the game.',
    proof: true, file: [/(^|\/)(locales?|translations?|lang)\/|\.po$|\.translation$|translations?\.csv$/i], text: [] },
  { id: 'language-picker', group: 'Language', name: 'Language choice in Options',
    why: 'Players switch language from the options menu, without restarting.',
    file: [], text: [/set_locale|set_language|Lang\.(set|choose|change)|LANGUAGES|locale_list|language_option|language_select|select_language/i] },

  // Debug
  { id: 'debug-panel', group: 'Debug', name: 'Debug panel',
    why: 'A hidden panel to skip ahead, give items or test a system while developing.',
    file: [/debug/i], text: [/debug_(menu|panel|console)|cheat/i] },
  { id: 'debug-only', group: 'Debug', name: 'Debug tools switched off in the release build',
    why: 'Cheats and debug keys must not reach the players who buy the game.',
    file: [], text: [/is_debug_build|has_feature\(["']debug["']\)/i] },

  // Information and feedback
  { id: 'version', group: 'Information and feedback', name: 'Version number shown',
    why: 'Players and testers can say which build they have.',
    file: [/version/i], text: [/config\/version|game_version|GAME_VERSION|APP_VERSION/i] },
  { id: 'patch-notes', group: 'Information and feedback', name: 'Patch notes',
    why: 'Tells players what changed in each update.',
    proof: true, file: [/patch_?notes?/i], text: [/patch_?notes?/i] },
  { id: 'how-to-play', group: 'Information and feedback', name: 'How to play or tutorial',
    why: 'New players learn the rules without leaving the game.',
    file: [/how_?to|tutorial|onboard/i], text: [/how_?to_?play|tutorial/i] },
  { id: 'credits', group: 'Information and feedback', name: 'Credits screen',
    why: 'Thanks the people and tools (music, fonts, art) the game uses.',
    file: [/credits?/i], text: [/credits?/i] },
  { id: 'feedback', group: 'Information and feedback', name: 'Way to send feedback or report a bug',
    why: 'Players can tell you what went wrong, from inside the game.',
    file: [], text: [/feedback|bug_?report|report_?bug|send_?logs/i] },

  // Sound
  { id: 'audio-player', group: 'Sound', name: 'Sound and music player',
    why: 'One place that plays sounds and music, so the rest of the code stays simple.',
    file: [/audio|sound|music|sfx/i], text: [/AudioStreamPlayer/i] },
  { id: 'audio-buses', group: 'Sound', name: 'Audio buses (music, sound effects)',
    why: 'Music and effects are separate channels, which the volume sliders can control.',
    proof: true, file: [/default_bus_layout/i], text: [/get_bus_index|AudioServer/i] },

  // Making and shipping
  { id: 'tests', group: 'Making and shipping', name: 'Automated tests',
    why: 'Checks that the core rules still work after each change.',
    proof: true, file: [/(^|\/)tests?\/|test_[^/]*\.gd$/i], text: [] },
  { id: 'export-presets', group: 'Making and shipping', name: 'Export presets for each platform',
    why: 'Builds for Windows, Web and so on are set up once, not every time.',
    proof: true, file: [/export_presets\.cfg$/i], text: [] },
  { id: 'error-log', group: 'Making and shipping', name: 'Errors saved to a log file',
    why: 'When a player hits a bug, there is a file to look at afterwards.',
    file: [], text: [/\.log["']|log_to_file|write_log|user:\/\/[^"']*logs?\b/i] },
];
