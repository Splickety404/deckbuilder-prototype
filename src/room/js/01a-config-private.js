/* =========================================================================
   PRIVATE CONFIG — the Google/Apps Script backend (private build only)
   ========================================================================= */
// The NEW, distinct game-room Web App — a fully generic service (see
// room_apps_script.gs); this URL is safe to hardcode since it isn't bound to
// any one room's data.
const ROOM_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwSvYNuugrPcPdppUzW-ggZJCoqCseY5TLsN1E6VRjlsjrDjvfb5oIqiXnEZfH_W08N/exec';
// The one Game Room spreadsheet everyone shares now — no longer something a
// player pastes in themselves. Every table this app hosts lives in this one
// sheet's event log, distinguished only by session code.
const ROOM_SHEET_ID = '1bcUd6qaDY72yGtSR5KBCtzSCZaBUtNL9PT9A7tKMXNI';

// Same OAuth client as the deckbuilder — an OAuth client's "authorized
// JavaScript origins" are per-origin, not per-file, so as long as this file
// is served from the same origin (e.g. the same GitHub Pages domain) as
// deckbuilder.html, reusing the id here needs no extra setup in Google Cloud
// Console at all.
const GOOGLE_CLIENT_ID = '1053912607552-pvrm9heedm4floaohv1olp5k5mdp95lq.apps.googleusercontent.com';

