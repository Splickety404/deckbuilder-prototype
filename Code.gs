// =====================================================================
// ECHO OF OMENS — Apps Script backend
// Serves the deckbuilder's card data and card version history. This script
// is scoped to the Card Library spreadsheet only — the game room's live
// session data (GameEvents) lives in its own separate spreadsheet + Apps
// Script project, entirely independent of this one.
//
// UPDATING CARDS: paste the card(s) you're adding or changing into a
// "Pending Updates" tab (same idea as before — same headers as Sheet1, in
// any order; only an "id" column is required). No function to run by hand
// anymore, though — the next time anyone opens the deckbuilder, that set's
// background sync (see syncSetImages) applies whatever's staged there on
// its own: each pasted row updates its matching card (archiving that card's
// prior state into CardHistory first) or, for an id that doesn't exist yet,
// gets added as a brand new card. A row with a "delete" column set to TRUE
// deletes that card instead (also archived into CardHistory first) — that's
// now the ONLY way a card gets deleted; see applyPendingUpdatesForSheet()
// below for the full explanation. For art, use the "Card Library Tools ->
// Override Card Art From Folder…" menu above the sheet instead.
//
// ACCESS CONTROL (added): every card-data/image-sync request for the
// deckbuilder now requires a signed-in Google identity (verifyIdToken)
// AND that identity being an actual Viewer/Editor/Owner of the Drive
// folder that set lives in (emailCanAccessFolder) — see the "ACCESS
// CONTROL" section below for the full rationale. cardsForSheet (used by
// room.html) and getCardHistory are NOT yet gated — see the comments on
// each; that's a deliberate, temporary scope limit, not an oversight.
//
// This is the WHOLE script — paste this in to replace everything.
// =====================================================================

const CARD_FOLDER_ID = '1ooG4YMvcKGzEWdIKDeI2-KvKofJddXTq'; // "Card PNGs" folder
const ROOT_FOLDER_ID = '1HpQ4c78LqzR_QDK288KMav8wjKSWT9B0'; // "Deckbuilder Assets" — holds Card PDFs, EOO Card Library, and the .pcio board file
const MAIN_SHEET_NAME = 'Sheet1';
const PENDING_SHEET_NAME = 'Pending Updates';
const HISTORY_SHEET_NAME = 'CardHistory';
// How long whoAmI's result is cached per email (see whoAmI below) — short enough that
// a newly-shared set still shows up reasonably promptly, long enough to absorb a page
// reload or a retried sign-in without redoing the full Drive scan.
const WHOAMI_CACHE_SECONDS = 180;

// Card art files can be PDFs, PNGs, or JPEGs interchangeably — Drive's own
// image-serving URL (https://lh3.googleusercontent.com/d/<fileId>) renders
// any of these as a viewable image regardless of which one it actually is, so
// nothing about how art is DISPLAYED (or exported — the Print & Play PDF
// export round-trips every image through a canvas and re-encodes it as JPEG
// regardless of source format) needs to know or care which format a given
// file is in. This only matters for the handful of places below that have to
// strip/match/reapply a file's extension by its name — and, separately, for
// how art gets FETCHED: see artUrl() just below.
const ART_FILE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];
function artExtensionPattern() {
  return new RegExp('\\.(?:' + ART_FILE_EXTENSIONS.join('|') + ')$', 'i');
}

// Builds the Drive image-serving URL for an art file, tagged with a URL fragment
// (harmless — never sent to any server, the client just reads it off the string) that
// tells deckbuilder.html's sizedUrl() whether it's safe to ask Google's image CDN for
// a specific pixel width. For a PDF, that's the only way to get a viewable image out
// of it at all, so it's always worth doing. For an already-rendered PNG/JPEG, asking
// for an arbitrary exact width instead of the file's own native size means Google has
// to dynamically resize it on request rather than just serving the file — real latency
// for something that gains nothing here, since these are already reasonably-sized
// individual card images rather than a page extracted from a large multi-card PDF.
// #pdf-src / #img-src is not a real fragment identifier, just a marker character
// sequence sizedUrl() checks for and strips before use.
//
// WHY lh3.googleusercontent.com, and not something else: researched this directly —
// the old drive.google.com/uc?export=view&id=... hotlink trick was broken by a Google
// change in early 2024 (now just 403s); drive.google.com/thumbnail?id=...&sz=wNNN
// still works but is capped at a fairly low resolution and rate-limits noticeably once
// a page requests more than a handful of images at once; the official Drive API
// (files.get?alt=media) needs a public API key exposed to every visitor's browser and
// has no built-in resizing at all. lh3 is the same CDN Google's own Drive/Photos UI
// itself uses for previews, is the most reliable of the bunch in practice, and is the
// only one of these that supports the on-the-fly =wNNN width resizing this app relies
// on — so it stays, with one real fix below.
//
// CACHE-BUSTING (the actual fix): the art-override tool (see overrideArtFromFolder())
// replaces a file's CONTENT while keeping its Drive file id exactly the same — which
// is the whole point (no URL ever needs to change downstream, no file-bloat from "old"
// copies) — but it means the URL string alone can't tell a browser or Google's own CDN
// that anything changed, so a cached copy of the OLD art could otherwise keep being
// served under the new file's nose. Appending the file's own last-modified timestamp
// as a "?v=" query parameter fixes this for free: Drive updates that timestamp the
// moment a file's content changes, so overwriting a file automatically mints a new
// URL for it (busting any cache of the old one) while every card whose art DIDN'T
// change keeps the exact same URL it always had, for maximum caching. lastUpdated is
// optional (a File wasn't always fetched everywhere this is called) — callers that
// don't have it yet just get the old, un-cache-busted URL, same as before.
function artUrl(fileId, fileName, lastUpdated) {
  const isPdf = /\.pdf$/i.test(fileName);
  const cacheBust = lastUpdated ? ('?v=' + lastUpdated.getTime()) : '';
  return 'https://lh3.googleusercontent.com/d/' + fileId + cacheBust + (isPdf ? '#pdf-src' : '#img-src');
}

// =====================================================================
// ACCESS CONTROL
//
// Design: the ONLY thing you ever grant is "share this set's Drive folder"
// — either with a specific person's email, or by flipping the folder's own
// sharing setting to "Anyone with the link" once a set is ready to be public
// (e.g. after release) — there is no separate list of approved users
// anywhere in this script. Permission is read live from Drive's own
// sharing state every time, via emailCanAccessFolder(). KNOWN_GAMES (below)
// is NOT permissions data — it has no emails in it at all — it's just the
// map of "which folder is which game" (sets within a game are discovered
// live, not hardcoded — see getSetsForGame), the one piece of bookkeeping
// that has to exist somewhere so the script knows what to even check a
// signed-in person's access against.
// =====================================================================

// Set this to the OAuth Client ID created for the deckbuilder's sign-in
// button (ends in .apps.googleusercontent.com). Not a secret.
const OAUTH_CLIENT_ID = '1053912607552-pvrm9heedm4floaohv1olp5k5mdp95lq.apps.googleusercontent.com';

// Every GAME that exists, by label + the Drive folder that CONTAINS that
// game's set folders. Add one line here whenever a new game exists — that's
// the only step needed to register it. A game's individual SETS are never
// hardcoded here at all: they're discovered live by scanning that game
// folder's immediate subfolders for anything shaped like a set (a folder
// containing a Google Sheet — see getSetsForGame below), so dropping in a
// new set folder, or renaming one, needs no code change whatsoever.
// (Not permissions data — see the ACCESS CONTROL note above. A set's own
// folder-sharing is still what actually gates access to it — see whoAmI.)
const KNOWN_GAMES = [
  { label: 'Echo of Omens', folderId: '1ohErfjHoaW7rW_MIkdGYMOYLewRilWpg' },
  { label: 'HellBreak', folderId: '1PrpSDlp7i-X0zMkStBD1dv8PWT9xlW28' },
  // { label: 'Some Future Game', folderId: 'paste its Drive folder id here' },
];

// Verifies a Google Identity Services ID token by asking Google itself
// (rather than re-implementing JWT signature verification here) and
// returns the signed-in person's verified email, or null if the token is
// missing, expired, malformed, or was issued for some OTHER app (a
// mismatched `aud` means someone is trying to replay a token that was
// never meant to authenticate against this deckbuilder at all).
// Returns { email, reason }. email is null on failure, and reason is a short
// diagnostic string saying why — TEMPORARILY surfaced all the way back to the
// browser's error message (via whoAmI, below) purely so we can see what's
// actually happening without fighting the Apps Script Executions log viewer,
// which hasn't been showing console output for these anonymous web app calls.
// None of this leaks anything secret (no tokens, no keys) — just fine to revert
// once the real cause is found.
function verifyIdToken(idToken) {
  if (!idToken) return { email: null, reason: 'no idToken was sent to the server at all' };
  try {
    const resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) {
      return { email: null, reason: 'Google tokeninfo returned HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText() };
    }
    const claims = JSON.parse(resp.getContentText());
    if (claims.aud !== OAUTH_CLIENT_ID) {
      return { email: null, reason: 'aud mismatch — token was issued for "' + claims.aud + '" but this script expects "' + OAUTH_CLIENT_ID + '"' };
    }
    if (String(claims.email_verified) !== 'true') {
      return { email: null, reason: 'email_verified was "' + claims.email_verified + '" for ' + claims.email };
    }
    return { email: String(claims.email).toLowerCase(), reason: null };
  } catch (err) {
    return { email: null, reason: 'verifyIdToken threw: ' + (err && err.message || err) };
  }
}

// Every immediate subfolder of a game's own folder that looks like a set — i.e.
// contains a Google Sheet — resolved live every time (never cached), so dropping in
// a new set folder or renaming one is picked up the next time anyone signs in, with
// no code change at all. gameLabel/gameFolderId are carried along purely so callers
// can group sets back by game without a second lookup.
function getSetsForGame(game) {
  const out = [];
  try {
    const subfolders = DriveApp.getFolderById(game.folderId).getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      const sheetFiles = sub.getFilesByType(MimeType.GOOGLE_SHEETS);
      if (sheetFiles.hasNext()) {
        out.push({
          folderId: sub.getId(),
          sheetId: sheetFiles.next().getId(),
          label: sub.getName(),
          gameLabel: game.label,
          gameFolderId: game.folderId,
        });
      }
    }
  } catch (err) {
    // game folder missing/inaccessible to the script itself -> it just contributes no sets
  }
  return out;
}

// True if `email` (already lowercased by verifyIdToken) has Viewer,
// Editor, or Owner access to that Drive folder. This is the actual
// permission check — it reads Drive's live sharing state on every call,
// so granting or revoking someone's access to a set is entirely a matter
// of sharing (or un-sharing) that one folder in Drive itself.
//
// NOTE: if the folder lives inside a Shared Drive, DriveApp's getOwner()/
// getViewers()/getEditors() above don't reliably see Shared Drive membership
// roles (Manager, Content Manager, Contributor, Viewer, Commenter) — those only
// reflect permissions added directly to this one file, and getOwner() can even
// throw for a Shared Drive item (a Shared Drive owns the file, not a person).
// The Drive API permission list below also picks up Shared Drive roles, so it
// covers both cases. This requires the "Drive API" advanced service to be
// enabled on this Apps Script project (Services -> + -> Drive API) — if it
// isn't, this check is simply skipped and only the DriveApp checks above apply.
// Retries the whole permission check up to 3x (short pause between attempts)
// before giving up. DriveApp's getViewers()/getEditors() in particular are
// prone to transient "Service invoked too many times" / rate-limit errors
// under load — previously ANY exception anywhere in this check (even a
// momentary Drive hiccup that would have succeeded a second later) was
// treated exactly like "genuinely not on the sharing list", i.e. silently
// returned false. For getCardsBySheetId (used by room.html's Peek), that
// false gets cached client-side as a permanent "_classified:true" for the
// rest of the game — a real access-check glitch masquerading as "you don't
// have access to this card" for the whole session, with peeking any other
// card from the same sheet is the only path that would ever revisit it.
// So now: if every attempt throws (never got a clean read of the sharing
// state), that's surfaced to the caller as a thrown error instead of a
// false "denied" — callers that already wrap this in try/catch (all of
// them) turn that into an ok:false error response, which is retried
// naturally rather than cached as a false denial.
function emailCanAccessFolder(email, folderId) {
  const ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return emailCanAccessFolder_once(email, folderId);
    } catch (err) {
      lastErr = err;
      if (attempt < ATTEMPTS) Utilities.sleep(250 * attempt);
    }
  }
  throw lastErr;
}

function emailCanAccessFolder_once(email, folderId) {
  const folder = DriveApp.getFolderById(folderId); // missing/genuinely inaccessible folder -> throws -> correctly denied by the retry wrapper above

  // Deliberate public toggle: if this folder's OWN Drive sharing is set to
  // "Anyone with the link" (or fully public, or shared with your whole
  // Workspace domain), that's honored as "everyone gets in" here too — same
  // "Drive's sharing state is the one and only source of truth" idea as the
  // named-grant checks below, just extended to cover Drive's built-in public
  // settings as well as individual people. This is what lets a set be flipped
  // from private to public (e.g. once it's officially released) purely by
  // changing its folder's sharing in Drive — no code change, no redeploy.
  try {
    const access = folder.getSharingAccess();
    if (access === DriveApp.Access.ANYONE ||
        access === DriveApp.Access.ANYONE_WITH_LINK ||
        access === DriveApp.Access.DOMAIN ||
        access === DriveApp.Access.DOMAIN_WITH_LINK) {
      return true;
    }
  } catch (shareErr) {
    // couldn't read the sharing-access level — fall through to the named-grant checks below
  }

  try {
    const owner = folder.getOwner();
    if (owner && owner.getEmail().toLowerCase() === email) return true;
  } catch (ownerErr) {
    // Shared Drive folders have no individual owner — expected, fall through.
  }
  // Deliberately NOT individually try/caught: a transient failure here should
  // propagate up to the retry wrapper, not be swallowed into "not a viewer".
  if (folder.getViewers().some(u => u.getEmail().toLowerCase() === email)) return true;
  if (folder.getEditors().some(u => u.getEmail().toLowerCase() === email)) return true;

  // Fallback: full permission list via the Drive API (advanced service), which also
  // reflects Shared Drive membership roles that DriveApp's own methods miss above.
  try {
    const perms = Drive.Permissions.list(folderId, {
      supportsAllDrives: true,
      fields: 'permissions(emailAddress,role)',
    }).permissions || [];
    if (perms.some(p => p.emailAddress && p.emailAddress.toLowerCase() === email)) return true;
  } catch (driveApiErr) {
    // Drive API advanced service not enabled on this project, or some other Drive
    // API error — this fallback just doesn't apply; the DriveApp checks above still do.
  }
  return false;
}

// ?whoami=1&idToken=...  ->  only the GAMES (each with only the SETS within it)
// THIS signed-in person may open — nested by game so the client can offer a
// "Game Selection" choice, then load only that game's accessible sets. A game
// is included only if the person can access at least one set inside it; a set
// is included only if THAT set's own folder-sharing grants them access — a
// game folder being public/shared doesn't by itself imply every set folder
// inside it is (Drive's own permission inheritance still applies underneath,
// same as always: sharing a game folder itself, rather than each set folder
// individually, is exactly how you'd make everything inside it public/shared
// in one step, if that's what you want for that game).
function whoAmI(idToken, callback) {
  const v = verifyIdToken(idToken);
  let result;
  if (!v.email) {
    result = { ok: false, error: 'Not signed in, or your sign-in has expired — please sign in again. [debug: ' + v.reason + ']' };
  } else {
    // whoAmI is the slowest, most Drive-API-heavy call in this script — for every
    // game it scans that game's set folders AND runs emailCanAccessFolder (which can
    // itself fall through to a Drive.Permissions.list Advanced Service call) for every
    // set found. That's the most likely source of the occasional slow/failed sign-in:
    // a transient Drive API hiccup, or Apps Script cold-start, anywhere in that chain
    // makes the whole call slow. A short cache keyed by email means a page reload or a
    // second sign-in attempt within WHOAMI_CACHE_SECONDS reuses the last good result
    // instead of redoing every one of those Drive calls — both faster and less likely
    // to hit a transient failure at all. The tradeoff: a permission change (sharing a
    // new set with someone) can take up to WHOAMI_CACHE_SECONDS to show up for them —
    // an accepted tradeoff for a cache this short.
    const cache = CacheService.getScriptCache();
    const cacheKey = 'whoAmI:' + v.email;
    const cached = cache.get(cacheKey);
    if (cached) {
      result = JSON.parse(cached);
    } else {
      const games = KNOWN_GAMES.map(game => {
        // getSetsForGame already resolved each set folder's live name (sub.getName())
        // while scanning game.folderId's immediate subfolders, so s.label here IS the
        // folder's current live name already — re-fetching it with a second
        // DriveApp.getFolderById(...).getName() call per set would just double the
        // Drive API work for every accessible set for no new information.
        const sets = getSetsForGame(game)
          .filter(s => {
            // emailCanAccessFolder now throws (after its own internal retries)
            // rather than silently returning false when the check itself kept
            // failing — appropriate for a single set's card fetch (see
            // getCardsBySheetId), but whoAmI lists every set across every game
            // in one pass, and one set's persistent Drive hiccup shouldn't sink
            // sign-in entirely. So here specifically: fall back to the old
            // behavior of just excluding that one set for this pass (it'll be
            // re-checked next sign-in, or once WHOAMI_CACHE_SECONDS expires).
            try { return emailCanAccessFolder(v.email, s.folderId); }
            catch (e) { return false; }
          })
          .map(s => ({ folderId: s.folderId, label: s.label }));
        let gameLabel = game.label;
        try { gameLabel = DriveApp.getFolderById(game.folderId).getName(); } catch (e) { /* keep fallback label */ }
        return { folderId: game.folderId, label: gameLabel, sets: sets };
      }).filter(g => g.sets.length > 0); // hide a game entirely if this person can't see any set in it

      result = { ok: true, email: v.email, games: games };
      try { cache.put(cacheKey, JSON.stringify(result), WHOAMI_CACHE_SECONDS); } catch (e) { /* cache write failing is never fatal — just skip the speedup this time */ }
    }
  }
  const json = JSON.stringify(result);
  if (callback) return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Run manually (or on a trigger) to keep front-image-url/back-image-url
// columns in the sheet pointed at the correct Drive files.
// ---------------------------------------------------------------------
function syncImageLinks() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIN_SHEET_NAME);
  syncImageLinksForSheet(sheet, CARD_FOLDER_ID);
}

// Generalized core — used both by the Set 1 sync above and by getSetData() below for
// any additional set's own sheet + Card PDFs folder.
function syncImageLinksForSheet(sheet, folderId) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idCol = headers.indexOf('id');
  let frontCol = headers.indexOf('front-image-url');
  let backCol = headers.indexOf('back-image-url');

  if (frontCol === -1) { frontCol = headers.length; sheet.getRange(1, frontCol + 1).setValue('front-image-url'); }
  if (backCol === -1) { backCol = headers.length + (frontCol === headers.length ? 1 : 0); sheet.getRange(1, backCol + 1).setValue('back-image-url'); }

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const nameToFile = {}; // base name (extension stripped) -> the Drive File itself, so artUrl() below can still see its extension
  while (files.hasNext()) {
    const f = files.next();
    nameToFile[f.getName().replace(artExtensionPattern(), '')] = f;
  }

  // Batched and change-detected rather than one setValue() call per cell, per row,
  // on every single call — this function runs on every getSetData request from every
  // user (every page load, every Resync), and previously rewrote every row's front/back
  // cells unconditionally even when nothing had changed since the last sync, which was
  // by far the slowest part of the request and a real source of Sheets write
  // contention once more than a couple of people use the deckbuilder at once. Now it
  // computes the full column first, and only issues a write (one batched setValues()
  // call per column, not per cell) when at least one value in that column actually
  // needs to change; a normal load where no art files were added/renamed writes
  // nothing at all.
  const numRows = data.length - 1;
  if (numRows <= 0) return;
  const newFront = new Array(numRows);
  const newBack = new Array(numRows);
  let frontChanged = false;
  let backChanged = false;
  for (let r = 1; r < data.length; r++) {
    const i = r - 1;
    const id = data[r][idCol];
    if (!id) {
      // No id on this row -> leave its front/back cells exactly as they were (same
      // as the original per-row "continue"), so the batch write below is a no-op here.
      newFront[i] = [data[r][frontCol]];
      newBack[i] = [data[r][backCol]];
      continue;
    }
    const frontFile = nameToFile[id];
    const backFile = nameToFile[id + '-back'];
    const frontUrl = frontFile ? artUrl(frontFile.getId(), frontFile.getName(), frontFile.getLastUpdated()) : '';
    const backUrl = backFile ? artUrl(backFile.getId(), backFile.getName(), backFile.getLastUpdated()) : '';
    newFront[i] = [frontUrl];
    newBack[i] = [backUrl];
    if (frontUrl !== data[r][frontCol]) frontChanged = true;
    if (backUrl !== data[r][backCol]) backChanged = true;
  }
  if (frontChanged) sheet.getRange(2, frontCol + 1, numRows, 1).setValues(newFront);
  if (backChanged) sheet.getRange(2, backCol + 1, numRows, 1).setValues(newBack);
}

// Every set across every known game, flattened — the one lookup both
// getCardsBySheetId and getCardHistory build their access checks on. Games are purely
// an organizational/UI layer on top of this; the access check itself is always
// against a SET's own folder (via emailCanAccessFolder), exactly as before.
function getKnownSetSheets() {
  const out = [];
  KNOWN_GAMES.forEach(game => { getSetsForGame(game).forEach(s => out.push(s)); });
  return out;
}

// ---------------------------------------------------------------------
// Returns raw row data for a sheet id's "Sheet1" tab, using THIS script's own
// elevated ("Execute as: Me") permissions rather than depending on the target
// sheet's own sharing settings. Used by room.html to resolve card data for
// whatever sheet(s) a given deck references.
//
// GATED, same as getSetData/scanSet: requires a verified signed-in identity.
// A signed-in identity that lacks Drive access to the set's own folder is NOT
// failed closed with an error the way an unverified caller is — instead this
// returns { ok:true, classified:true, ids:[...] }: every real card id on the
// sheet, with every other column withheld entirely (not blanked — withheld,
// so nothing about a classified card's identity, art, or text is inferable
// from the response shape). room.html uses this to still place a working
// piece on the table for that card (it has a real id, so it can be moved,
// stacked, counted, flipped) while rendering its face as "Classified" rather
// than showing what the card actually is. A genuinely unverified caller (no
// idToken, expired token, unknown sheet id) gets the harder ok:false failure
// — and so, as of the emailCanAccessFolder rework above, does a caller whose
// access check itself kept failing (Drive quota/transient errors, retried
// internally 3x before giving up): that surfaces here as an ordinary thrown
// error -> ok:false, NOT classified:true, since it isn't actually a access
// decision. That distinction matters because the client (room.html) caches
// a classified:true result per card id for the rest of the game session —
// caching a transient glitch as "classified" would have shown a card as
// permanently private to someone who does have access, for every peek, for
// the rest of the game (this is the room.html Peek reload logic's own fix).
// ---------------------------------------------------------------------
function getCardsBySheetId(sheetId, idToken, callback) {
  let result;
  try {
    const v = verifyIdToken(idToken);
    if (!v.email) throw new Error('Not signed in, or your sign-in has expired — please sign in again. [debug: ' + v.reason + ']');
    const match = getKnownSetSheets().find(s => s.sheetId === sheetId);
    if (!match) throw new Error('Unknown sheet.');

    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName('Sheet1');
    if (!sheet) throw new Error('No "Sheet1" tab found in that spreadsheet.');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    if (!emailCanAccessFolder(v.email, match.folderId)) {
      const idCol = headers.indexOf('id');
      const ids = idCol === -1 ? [] : data.slice(1).map(row => row[idCol]).filter(Boolean);
      result = { ok: true, classified: true, ids: ids };
    } else {
      const rows = data.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i]; });
        return obj;
      });
      result = { ok: true, rows: rows };
    }
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  const json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Serves a card set given its Drive folder ID — gated: the caller must be
// signed in (idToken) AND that identity must actually have Viewer/Editor/
// Owner access to folderId in Drive. Looks for exactly one Google Sheet
// inside the folder and one card-art subfolder (see findCardArtFolder —
// any immediate subfolder with "card" in its name, so different games can
// call it "Card PDFs", "Cards", "Card Images", etc. without a code change).
// Set 1 now goes through this exact same path too (see KNOWN_GAMES above)
// rather than the old separate unauthenticated default feed.
// Never throws to the caller — always returns {ok, ...} so the
// client can show a clean error instead of a raw Apps Script failure page.
// ---------------------------------------------------------------------
// `fast`: when truthy, skips the live Drive art-folder scan (syncImageLinksForSheet)
// that otherwise runs on every call — that scan is what makes this request slow (it's
// a real Drive API folder listing, not just a Sheets read), and none of it is needed
// to return card text. The client calls getSetData(fast=true) first so text data comes
// back immediately, using whatever image URLs already happen to be in the sheet from
// the last sync, then separately calls syncSetImagesForSet() below to catch those
// URLs up and push the result back in once the scan actually finishes.
function getSetData(folderId, idToken, callback, fast) {
  let result;
  try {
    const v = verifyIdToken(idToken);
    if (!v.email) throw new Error('Not signed in, or your sign-in has expired — please sign in again. [debug: ' + v.reason + ']');
    const email = v.email;
    if (!emailCanAccessFolder(email, folderId)) throw new Error('You do not have access to this set.');

    const folder = DriveApp.getFolderById(folderId);
    const setName = folder.getName();

    const sheetFiles = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    if (!sheetFiles.hasNext()) throw new Error('No Google Sheet found in that folder.');
    const sheetFile = sheetFiles.next();
    const ss = SpreadsheetApp.openById(sheetFile.getId());
    const sheet = ss.getSheetByName('Sheet1');
    if (!sheet) throw new Error('The sheet in that folder has no "Sheet1" tab.');

    if (!fast) {
      const artFolder = findCardArtFolder(folder);
      if (artFolder) {
        syncImageLinksForSheet(sheet, artFolder.getId());
      }
    }

    // Card backs and the .pcio board file all now live in the GAME's own main folder
    // (the set folder's immediate parent) — not inside this individual set folder —
    // since a single game can have several sets that all share one board file and one
    // set of card backs. Resolved live, once per call, from whichever folder actually
    // contains this set.
    // Skipped entirely on the fast path: it's its own live Drive folder listing (same
    // cost profile as the art-folder scan above), and since it reads the GAME's shared
    // folder, running it once per SET means the exact same scan repeats for every set
    // in a multi-set game. The client fetches this once per game instead, via the
    // separate gameAssets endpoint below, after card text is already showing.
    const gameFolderId = getParentFolderId(folder);
    const assets = (!fast && gameFolderId) ? scanGameFolderAssets(gameFolderId) : emptyGameFolderAssets();

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    result = {
      ok: true, setName: setName, sheetId: sheetFile.getId(), rows: rows,
      // Generic (non-Echo) game-agnostic deckbuilder mode: a single shared card back
      // for every non-double-sided card in exports.
      genericBackUrl: assets.genericBackUrl,
      // Echo mode's own three-way overlord/scheme/champion generic-back mechanism.
      genericBacks: { overlordBackUrl: assets.overlordBackUrl, schemeBackUrl: assets.schemeBackUrl, championBackUrl: assets.championBackUrl },
      // Whether this game has a .pcio board file at all — the client only offers to
      // download one when this says so.
      pcio: assets.pcio,
    };
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }

  const json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// The slow half getSetData(fast=true) deliberately skips: does the live Drive
// art-folder scan (via syncImageLinksForSheet) and returns just the resulting
// id/front-image-url/back-image-url triples, not the full row data — the client
// already has everything else from its earlier fast call and only needs to merge
// these in. Called once per set, right after that set's fast card data has already
// rendered, so art can "pop in" per set as each one's scan finishes.
function syncSetImages(folderId, idToken, callback) {
  let result;
  try {
    const v = verifyIdToken(idToken);
    if (!v.email) throw new Error('Not signed in, or your sign-in has expired — please sign in again. [debug: ' + v.reason + ']');
    const email = v.email;
    if (!emailCanAccessFolder(email, folderId)) throw new Error('You do not have access to this set.');

    const folder = DriveApp.getFolderById(folderId);
    const sheetFiles = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    if (!sheetFiles.hasNext()) throw new Error('No Google Sheet found in that folder.');
    const sheetFile = sheetFiles.next();
    const ss = SpreadsheetApp.openById(sheetFile.getId());
    const sheet = ss.getSheetByName('Sheet1');
    if (!sheet) throw new Error('The sheet in that folder has no "Sheet1" tab.');

    const artFolder = findCardArtFolder(folder);
    if (artFolder) {
      syncImageLinksForSheet(sheet, artFolder.getId());
    }

    // Runs automatically here, once per set, every time the deckbuilder loads that
    // set — applies whatever's staged in that set's own "Pending Updates" tab (if
    // any) to Sheet1, with no function to run by hand. See
    // applyPendingUpdatesForSheet()'s own comment for the full explanation.
    applyPendingUpdatesForSheet(ss, sheet);

    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const frontCol = headers.indexOf('front-image-url');
    const backCol = headers.indexOf('back-image-url');
    const images = data.slice(1)
      .filter(row => idCol !== -1 && row[idCol])
      .map(row => ({
        id: row[idCol],
        'front-image-url': frontCol !== -1 ? row[frontCol] : '',
        'back-image-url': backCol !== -1 ? row[backCol] : '',
      }));

    result = { ok: true, sheetId: sheetFile.getId(), images: images };
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }

  const json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// Game-level assets (card backs, .pcio board) live in the GAME's own main folder and
// are shared by every set inside it — getSetData(fast=true) skips scanning for them
// entirely rather than repeat that same folder scan once per set. The client instead
// calls this ONCE per game (via state.currentGameFolderId), in the background, after
// card text is already showing. Access is granted if the signed-in user can see at
// least one SET within this game — the same bar whoAmI() already uses to decide
// whether to list the game at all.
function getGameAssets(gameFolderId, idToken, callback) {
  let result;
  try {
    const v = verifyIdToken(idToken);
    if (!v.email) throw new Error('Not signed in, or your sign-in has expired — please sign in again. [debug: ' + v.reason + ']');
    const email = v.email;
    const sets = getSetsForGame({ folderId: gameFolderId, label: '' });
    if (!sets.some(s => emailCanAccessFolder(email, s.folderId))) {
      throw new Error('You do not have access to this game.');
    }
    result = Object.assign({ ok: true }, scanGameFolderAssets(gameFolderId));
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }

  const json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// PENDING UPDATES — the entire "add/change/delete cards" mechanism. Paste
// the card row(s) you're adding or changing into a set's own "Pending
// Updates" tab: same idea as the old manual flow (any of that set's own
// column headers, in any order, near-miss spelling/punctuation is fine —
// see normalizeHeader — only an "id" column is required), but nothing to
// run by hand anymore. Every time the deckbuilder loads that set, its
// background sync (see syncSetImages below) calls this, which applies
// whatever's staged there and clears the tab back out:
//
//   - id already exists in Sheet1 -> that row's CURRENT state is archived
//     into CardHistory first (archive-reason "update"), then only the
//     columns you actually pasted a value for are overwritten — anything
//     you left out of the pasted row is left exactly as it was.
//   - id doesn't exist yet -> treated as a brand new card, appended to
//     Sheet1 as a new row.
//   - a "delete" column on that row with a truthy value (TRUE, a checked
//     checkbox, "yes", etc) -> that card is archived into CardHistory
//     (archive-reason "deletion") and removed from Sheet1 instead of being
//     updated. This is now the ONLY way a card is ever deleted — nothing
//     here ever removes a card just because it was left out of a batch;
//     Sheet1 rows you don't mention are never touched. Marking an id that
//     doesn't exist yet for deletion is simply a no-op.
//
// LockService guards this against two people opening the deckbuilder for
// the same set at once both applying the same batch twice. If the lock is
// already held, this run just skips quietly — whoever's holding it will
// apply the batch, and a slightly later page load will simply see nothing
// left staged.
// ---------------------------------------------------------------------
function applyPendingUpdatesForSheet(ss, mainSheet) {
  const pendingSheet = ss.getSheetByName(PENDING_SHEET_NAME);
  if (!pendingSheet) return; // nothing staged for this set -> nothing to do
  if (pendingSheet.getLastRow() < 2) return; // header row only (or empty) -> nothing to do

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return; // someone else is already applying this set's batch — skip rather than block the page load
  try {
    // Re-read once the lock is actually held, in case another request already
    // applied and cleared this exact batch while this one was waiting.
    const pendingData = pendingSheet.getDataRange().getValues();
    if (pendingData.length < 2) return;
    const pendingHeaders = pendingData[0];
    const pendingIdCol = pendingHeaders.findIndex(h => normalizeHeader(h) === 'id');
    if (pendingIdCol === -1) return; // no "id" column -> nothing safe to match, skip
    const pendingDeleteCol = pendingHeaders.findIndex(h => normalizeHeader(h) === 'delete');

    const mainData = mainSheet.getDataRange().getValues();
    let mainHeaders = mainData[0];
    const idCol = mainHeaders.indexOf('id');
    if (idCol === -1) return; // Sheet1 itself has no "id" column -> nothing safe to do

    let lastUpdatedCol = mainHeaders.indexOf('last-updated');
    if (lastUpdatedCol === -1) {
      lastUpdatedCol = mainHeaders.length;
      mainSheet.getRange(1, lastUpdatedCol + 1).setValue('last-updated');
      mainHeaders = mainHeaders.concat(['last-updated']);
    }

    // Original (pre-edit) row numbers — safe to use for the deletions handled
    // below even after updates/inserts happen first, since updates never move a
    // row and inserts only ever add new rows at the very end.
    const idToRow = {};
    for (let r = 1; r < mainData.length; r++) idToRow[mainData[r][idCol]] = r + 1; // 1-based sheet row

    const historySheet = getOrCreateHistorySheet(mainHeaders);
    const historyHeaders = historySheet.getRange(1, 1, 1, historySheet.getLastColumn()).getValues()[0];

    const now = new Date();
    let updatedCount = 0, insertedCount = 0, deletedCount = 0;
    const rowsToDelete = [];

    for (let r = 1; r < pendingData.length; r++) {
      const id = pendingData[r][pendingIdCol];
      if (!id) continue;
      // Keyed by NORMALIZED header name, so "is-double-sided" in the pasted data
      // still matches Sheet1's "is_double_sided" column, a differently-cased
      // "Card-Cost" still matches "card-cost", etc.
      const pendingRow = {};
      pendingHeaders.forEach((h, i) => { pendingRow[normalizeHeader(h)] = pendingData[r][i]; });
      const isDelete = pendingDeleteCol !== -1 && isTruthyFlag(pendingData[r][pendingDeleteCol]);
      const sheetRowNum = idToRow[id];

      if (isDelete) {
        if (sheetRowNum) {
          const currentVals = mainSheet.getRange(sheetRowNum, 1, 1, mainHeaders.length).getValues()[0];
          historySheet.appendRow(historyHeaders.map(h => {
            if (h === 'archived-at') return now;
            if (h === 'archive-reason') return 'deletion';
            const idx = mainHeaders.indexOf(h);
            return idx !== -1 ? currentVals[idx] : '';
          }));
          rowsToDelete.push(sheetRowNum);
          deletedCount++;
        }
        // else: marked for deletion but never existed in the first place -> no-op.
        continue;
      }

      if (sheetRowNum) {
        const currentVals = mainSheet.getRange(sheetRowNum, 1, 1, mainHeaders.length).getValues()[0];
        historySheet.appendRow(historyHeaders.map(h => {
          if (h === 'archived-at') return now;
          if (h === 'archive-reason') return 'update';
          const idx = mainHeaders.indexOf(h);
          return idx !== -1 ? currentVals[idx] : '';
        }));
        mainHeaders.forEach((h, colIdx) => {
          const norm = normalizeHeader(h);
          if (norm === 'lastupdated') return;
          if (Object.prototype.hasOwnProperty.call(pendingRow, norm)) {
            mainSheet.getRange(sheetRowNum, colIdx + 1).setValue(pendingRow[norm]);
          }
        });
        mainSheet.getRange(sheetRowNum, lastUpdatedCol + 1).setValue(now);
        updatedCount++;
      } else {
        const newRow = mainHeaders.map(h => {
          const norm = normalizeHeader(h);
          if (norm === 'lastupdated') return now;
          return Object.prototype.hasOwnProperty.call(pendingRow, norm) ? pendingRow[norm] : '';
        });
        mainSheet.appendRow(newRow);
        insertedCount++;
      }
    }

    // Highest row number first, so deleting one row never shifts another
    // still-pending deletion's row number out from under it.
    rowsToDelete.sort((a, b) => b - a).forEach(rowNum => mainSheet.deleteRow(rowNum));

    pendingSheet.getRange(2, 1, pendingData.length - 1, pendingHeaders.length).clearContent();

    if (updatedCount || insertedCount || deletedCount) {
      Logger.log(`applyPendingUpdatesForSheet: ${updatedCount} updated, ${insertedCount} new, ${deletedCount} deleted.`);
    }
  } finally {
    lock.releaseLock();
  }
}

// Treats Sheets' own TRUE boolean (a real checkbox cell), and the plain text
// "true"/"yes"/"y"/"1" in any case, as a checked "delete" flag — covers both
// an actual checkbox column and someone just typing TRUE into a text cell.
function isTruthyFlag(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  return /^(true|yes|y|1)$/i.test(String(v || '').trim());
}

// ---------------------------------------------------------------------
// ART OVERRIDE TOOL — a custom menu item (see onOpen below), so updating a
// batch of card art is "paste a folder link, click OK", not editing code.
//
// Point it at a staging folder containing new/replacement card art files,
// named exactly the way this project already expects ({id}.png,
// {id}-back.pdf, etc — the same convention syncImageLinksForSheet's own
// nameToFile matching already uses). For each staged file:
//
//   - a file whose base name matches one ALREADY in the destination folder
//     -> that existing Drive file's CONTENT is overwritten in place, at its
//     same file id (Drive.Files.update with keepRevisionForever:true). Same
//     file id means front-image-url/back-image-url never need to change for
//     that card — nothing downstream has to know or care — and the old
//     content stays retrievable forever afterwards via Drive's own
//     right-click "Manage versions" on that file, with no "-old-" copy
//     cluttering the folder. (This doesn't save storage — Drive still keeps
//     the old bytes around as a prior revision — the win is a folder that
//     only ever shows the current art, plus native version history if you
//     ever need to look back.)
//
//   - a staged file with NO matching existing file -> treated as a brand
//     new card's art: a plain upload into the destination folder. This is
//     expected to be the NORMAL case for a folder that's been emptied and
//     is being rebuilt from scratch (e.g. redoing an entire set's art) —
//     not an error, not even worth a warning.
//
// Nothing in Sheet1 is touched by this tool directly — the very next set
// load (or the "Sync Set Images" the deckbuilder already does) re-scans the
// destination folder and picks up every add/replace on its own, and that
// same load's automatic change log (logCardChanges, above) is what notices
// and records which cards' art actually changed.
// ---------------------------------------------------------------------
function overrideArtFromFolder(stagingFolderId, destFolderId) {
  destFolderId = destFolderId || CARD_FOLDER_ID;
  const stagingFolder = DriveApp.getFolderById(stagingFolderId);
  const destFolder = DriveApp.getFolderById(destFolderId);

  // Same base-name (extension stripped) -> File matching syncImageLinksForSheet
  // itself uses, so "which existing file does this staged file replace" is decided
  // the exact same way everywhere in this script.
  const existingByName = {};
  const existingFiles = destFolder.getFiles();
  while (existingFiles.hasNext()) {
    const f = existingFiles.next();
    existingByName[f.getName().replace(artExtensionPattern(), '')] = f;
  }

  let overwritten = 0, uploaded = 0, skipped = 0;
  const details = [];

  const stagedFiles = stagingFolder.getFiles();
  while (stagedFiles.hasNext()) {
    const staged = stagedFiles.next();
    const name = staged.getName();
    const baseName = name.replace(artExtensionPattern(), '');
    if (baseName === name) {
      // No recognized card-art extension (stray .DS_Store, a Google Doc left in the
      // folder by mistake, etc) — skip rather than guess at what to do with it.
      skipped++;
      continue;
    }

    const existing = existingByName[baseName];
    const blob = staged.getBlob();

    if (existing) {
      // Belt-and-suspenders: pin whatever the CURRENT head revision is turning into
      // "the old version" before swapping it, in case that file predates this tool and
      // was never uploaded with keepRevisionForever itself. Best-effort — the overwrite
      // below still proceeds even if this fails.
      try { pinCurrentRevision(existing.getId()); } catch (err) { /* non-fatal */ }

      Drive.Files.update({ name: existing.getName() }, existing.getId(), blob,
        { keepRevisionForever: true, supportsAllDrives: true });
      overwritten++;
      details.push('Overwrote: ' + existing.getName());
    } else {
      destFolder.createFile(blob).setName(name);
      uploaded++;
      details.push('Added new: ' + name);
    }
  }

  return { overwritten: overwritten, uploaded: uploaded, skipped: skipped, details: details };
}

// Pins a file's current head revision as "Keep forever" so it survives Drive's normal
// revision pruning (revisions not marked keepForever are dropped after ~30 days, or
// sooner past 100 kept revisions) even if it was never explicitly pinned before —
// belt-and-suspenders for art that predates this tool. Best-effort: revisions.list
// can occasionally fail (permissions, a Shared Drive quirk) — the caller treats that
// as non-fatal and proceeds with the overwrite regardless.
function pinCurrentRevision(fileId) {
  const revisions = Drive.Revisions.list(fileId, { fields: 'revisions(id)' }).revisions;
  if (!revisions || !revisions.length) return;
  const headRevisionId = revisions[revisions.length - 1].id;
  Drive.Revisions.update({ keepForever: true }, fileId, headRevisionId);
}

// The Seth-friendly front door to overrideArtFromFolder() above: a plain
// "paste a folder link" prompt, no code, no picking a function to run from a
// dropdown. Always targets THIS script's own set (CARD_FOLDER_ID) — that's
// the one folder syncImageLinks()/the deckbuilder already treat as this
// sheet's card art home.
function promptOverrideArtFromFolder() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Override Card Art From Folder',
    'Paste the link (or just the folder ID) to the folder with your updated/new card art files, named exactly like your existing ones (e.g. "0042.png", "0042-back.pdf"):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const input = resp.getResponseText().trim();
  if (!input) return;

  const stagingFolderId = extractFolderIdFromInput(input);
  if (!stagingFolderId) {
    ui.alert('Could not find a folder ID in what you pasted — try pasting the full folder link instead.');
    return;
  }

  let result;
  try {
    result = overrideArtFromFolder(stagingFolderId, CARD_FOLDER_ID);
  } catch (err) {
    ui.alert('Something went wrong: ' + String((err && err.message) || err) +
      '\n\nDouble check that the folder link is correct and shared with this script.');
    return;
  }

  promoteCopySuffixedFiles(); // clean up any "{id} copy.pdf"-style names Drive sync tools sometimes leave behind
  syncImageLinks(); // pick up every new/changed file's URL into Sheet1 right away, rather than waiting for the next deckbuilder load

  ui.alert(
    'Done!\n\n' +
    result.overwritten + ' existing card(s) updated in place.\n' +
    result.uploaded + ' new card art file(s) added.' +
    (result.skipped ? '\n' + result.skipped + ' file(s) skipped (not a recognized card-art file type).' : '')
  );
}

// Accepts either a raw Drive folder id or a full folder URL
// (https://drive.google.com/drive/folders/<id>...) and returns just the id.
function extractFolderIdFromInput(input) {
  const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input; // looks like a bare id already
  return null;
}

// Adds the "Card Library Tools" menu to this spreadsheet's UI on open.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Card Library Tools')
    .addItem('Override Card Art From Folder…', 'promptOverrideArtFromFolder')
    .addToUi();
}

// If your upload method created "{id} copy.pdf" / "{id}-back copy 2.pdf"-style files
// (common with a locally-synced Drive folder, which enforces unique filenames and
// prompts "keep both"), this strips that suffix so the plain "{id}.pdf" name — the
// one syncImageLinks() actually looks for — is what ends up live. Called after the
// art-override tool runs, before the sync it triggers.
function promoteCopySuffixedFiles() {
  const folder = DriveApp.getFolderById(CARD_FOLDER_ID);
  const files = folder.getFiles();
  const copyPattern = new RegExp(
    '^(.*?)(?:\\s*-?\\s*copy(?:\\s*\\d+)?|\\s*\\(\\d+\\))(\\.(?:' + ART_FILE_EXTENSIONS.join('|') + '))$', 'i'
  );
  while (files.hasNext()) {
    const f = files.next();
    const m = f.getName().match(copyPattern);
    if (m) f.setName(m[1] + m[2]); // m[2] preserves whatever the real extension was, instead of forcing .pdf
  }
}

// Treats "is-double-sided", "is_double_sided", "Is Double Sided" etc. as the same
// column, so near-miss header spelling differences (like pasting a differently-
// organized export) don't silently fail to update that field.
function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[-_\s]+/g, '');
}

// RUN THIS after pasting the ids of cards to permanently remove into the "Pending
// Deletions" tab (just needs an "id" column — a "name" column alongside it is fine too,
// purely for your own reference, and is ignored). Archives each card's full current
// row into CardHistory (tagged archive-reason: "deletion") before removing it from
// Sheet1, so a deleted card's last-known identity is never actually lost — the
// deckbuilder can still show players what it used to be.
function getOrCreateHistorySheet(currentHeaders) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(HISTORY_SHEET_NAME);
  const wanted = ['archived-at', 'archive-reason'].concat(currentHeaders);
  if (sheet.getLastColumn() === 0) {
    // Either brand new, or an empty tab by this name already existed — either way,
    // there's no header row yet, so write one instead of reading a 0-width range.
    sheet.appendRow(wanted);
    return sheet;
  }
  // If Sheet1 has gained columns (or this tab predates "archive-reason") extend to match.
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const missing = wanted.filter(h => existing.indexOf(h) === -1);
  if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  return sheet;
}

// ---------------------------------------------------------------------
// Web App entry points. Game-session/event data (play.html) is NOT handled
// here at all anymore — it lives in its own separate spreadsheet + Apps
// Script project, entirely independent of this Card Library script.
//   ?cardHistory=<id>&idToken=...     -> past versions of one card, for the
//                                        deckbuilder's version-history view
//                                        (gated — see getCardHistory)
//   ?latestPcio=1                     -> info on the current .pcio board file
//   ?whoami=1&idToken=...             -> the sets THIS signed-in person may open
//   ?scanSet=<folderId>&idToken=...   -> that set's card data (gated). Add
//                                        &fast=1 to skip the live Drive art-folder
//                                        scan AND the game-level asset scan (card
//                                        backs/.pcio) and return text immediately,
//                                        using whatever image URLs are already in
//                                        the sheet from the last sync.
//   ?syncSetImages=<folderId>&idToken=... -> runs that art-folder scan and returns
//                                        just the resulting id/front-image-url/
//                                        back-image-url triples (gated) — the
//                                        slow half a &fast=1 scanSet skipped,
//                                        meant to be called right after it.
//   ?gameAssets=<gameFolderId>&idToken=... -> runs the game-level asset scan (card
//                                        backs/.pcio board) a &fast=1 scanSet also
//                                        skipped (gated) — meant to be called ONCE
//                                        per game, not once per set within it.
//   ?cardsForSheet=<sheetId>&idToken=... -> used by room.html (gated — see
//                                        getCardsBySheetId; an authenticated
//                                        caller without access to the set
//                                        gets id-only "classified" placeholder
//                                        data rather than a hard failure)
//   (none of the above)               -> no action specified (see below —
//                                        this used to be an unauthenticated
//                                        Set 1 data dump; it no longer is)
// ---------------------------------------------------------------------
function doGet(e) {
  if (e.parameter.cardHistory) {
    return getCardHistory(e.parameter.cardHistory, e.parameter.idToken, e.parameter.callback);
  }
  if (e.parameter.latestPcio) {
    return getLatestPcioInfo(e.parameter.folderId, e.parameter.callback);
  }
  if (e.parameter.help) {
    return getHelpArticles(e.parameter.folderId, e.parameter.callback);
  }
  if (e.parameter.whoami) {
    return whoAmI(e.parameter.idToken, e.parameter.callback);
  }
  if (e.parameter.scanSet) {
    return getSetData(e.parameter.scanSet, e.parameter.idToken, e.parameter.callback, !!e.parameter.fast);
  }
  if (e.parameter.syncSetImages) {
    return syncSetImages(e.parameter.syncSetImages, e.parameter.idToken, e.parameter.callback);
  }
  if (e.parameter.gameAssets) {
    return getGameAssets(e.parameter.gameAssets, e.parameter.idToken, e.parameter.callback);
  }
  if (e.parameter.cardsForSheet) {
    return getCardsBySheetId(e.parameter.cardsForSheet, e.parameter.idToken, e.parameter.callback);
  }

  // No recognized action. This used to fall through to an unauthenticated
  // dump of Set 1's raw card data — every set (Set 1 included) is now
  // fetched via ?scanSet=<folderId>&idToken=... (see whoAmI / getSetData
  // above), so nothing in normal use should ever reach this branch.
  const json = JSON.stringify({ ok: false, error: 'No action specified.' });
  if (e.parameter.callback) {
    return ContentService.createTextOutput(e.parameter.callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// GATED: reveals a card's past versions (including possibly unreleased
// text/stats it once had), given just its id. This function always reads
// the CardHistory tab of THIS script's own bound spreadsheet (never an
// arbitrary one), so the access check is: which known set's sheet IS
// this bound spreadsheet, and does the caller have Drive access to that
// set's folder? Same verifyIdToken/emailCanAccessFolder pattern as
// getSetData/getCardsBySheetId above.
function getCardHistory(cardId, idToken, callback) {
  let rows = [];
  try {
    const v = verifyIdToken(idToken);
    if (!v.email) throw new Error('Not signed in, or your sign-in has expired — please sign in again. [debug: ' + v.reason + ']');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const match = getKnownSetSheets().find(s => s.sheetId === ss.getId());
    if (!match) throw new Error('This card library is not registered as a known set.');
    if (!emailCanAccessFolder(v.email, match.folderId)) throw new Error('You do not have access to this set.');

    const sheet = ss.getSheetByName(HISTORY_SHEET_NAME);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const idCol = headers.indexOf('id');
      rows = data.slice(1)
        .filter(row => row[idCol] === cardId)
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = (row[i] instanceof Date) ? row[i].toISOString() : row[i]; });
          return obj;
        });
    }
  } catch (err) {
    // Fails "closed" as an empty history rather than a raw error — a caller
    // without access sees the same empty result as a genuinely history-less
    // card, rather than a message confirming whether that card id even exists.
    rows = [];
  }
  const json = JSON.stringify(rows);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// The immediate parent folder's id, or null if the folder has none (or none the
// script can see) — used to walk from a SET folder up to its owning GAME folder,
// since that's now where card backs and the .pcio board file live (one game can have
// several sets that all share one board and one set of card backs).
function getParentFolderId(folder) {
  try {
    const parents = folder.getParents();
    return parents.hasNext() ? parents.next().getId() : null;
  } catch (err) {
    return null;
  }
}

// Finds a set folder's card-art subfolder by name, without requiring an exact match —
// any immediate subfolder whose name contains "card" (case-insensitive) qualifies, so
// "Card PDFs", "Cards", "Card Images", etc. all work with zero code changes needed per
// game. If more than one subfolder matches, the first one found wins (Drive folders
// don't have a meaningful stable order, so a set should really only have one).
function findCardArtFolder(folder) {
  try {
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      if (/card/i.test(sub.getName())) return sub;
    }
  } catch (err) {
    // folder inaccessible -> no art folder found
  }
  return null;
}

function emptyGameFolderAssets() {
  return { genericBackUrl: '', overlordBackUrl: '', schemeBackUrl: '', championBackUrl: '', pcio: { found: false } };
}

// One pass over a GAME's own main folder (not any individual set's folder) for
// everything that lives there rather than inside a specific set: the .pcio board
// file, the generic (non-Echo) game-agnostic deckbuilder's single shared card back
// ("back.png"/"back.pdf"/etc), and Echo mode's own three-way overlord/scheme/champion
// generic backs (overlordback / schemeback / championback) — distinct from the unique
// per-card back a genuinely double-sided card already has via its own -back file.
// Resolved live every time, never cached, so dropping in or renaming any of these
// files just works on the next load.
function scanGameFolderAssets(gameFolderId) {
  const result = emptyGameFolderAssets();
  let folder;
  try {
    folder = DriveApp.getFolderById(gameFolderId);
  } catch (err) {
    return result; // game folder missing/inaccessible to the script itself
  }
  const files = folder.getFiles();
  let bestPcio = null;
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (/\.pcio$/i.test(name)) {
      if (!bestPcio || f.getLastUpdated() > bestPcio.getLastUpdated()) bestPcio = f;
      continue;
    }
    const base = name.replace(artExtensionPattern(), '').toLowerCase();
    const url = artUrl(f.getId(), name, f.getLastUpdated());
    if (base === 'back') result.genericBackUrl = url;
    else if (base === 'overlordback') result.overlordBackUrl = url;
    else if (base === 'schemeback') result.schemeBackUrl = url;
    else if (base === 'championback') result.championBackUrl = url;
  }
  result.pcio = bestPcio
    ? { found: true, name: bestPcio.getName(), id: bestPcio.getId(), downloadUrl: 'https://drive.google.com/uc?export=download&id=' + bestPcio.getId() }
    : { found: false };
  return result;
}

// Thin standalone wrapper around scanGameFolderAssets' .pcio result, kept as its own
// endpoint for anything that wants just the board file without a full set fetch.
function getLatestPcioInfo(gameFolderId, callback) {
  const json = JSON.stringify(scanGameFolderAssets(gameFolderId).pcio);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// RUN THIS whenever you want the icon-breakdown analysis refreshed. bonus-icons-scripted
// packs multiple icons into one cell ("Arcane / Arcane"), which QUERY() can't split and
// pivot in a single formula — this explodes it into one row per icon-instance on a
// helper tab, so a normal QUERY pivot (same pattern as the type/rarity breakdowns) can
// run against IT instead. A card with "Arcane / Arcane" contributes 2 to the Arcane
// count, matching "how many of each icon" rather than "how many cards have this icon".
const ICON_BREAKDOWN_SHEET_NAME = 'IconBreakdown';
function buildIconBreakdown() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(MAIN_SHEET_NAME);
  const data = mainSheet.getDataRange().getValues();
  const headers = data[0];
  const iconCol = headers.indexOf('bonus-icons-scripted');
  const aspectCol = headers.indexOf('aspect');
  const loyaltyCol = headers.indexOf('loyalty');
  if (iconCol === -1 || aspectCol === -1 || loyaltyCol === -1) {
    throw new Error('Could not find bonus-icons-scripted, aspect, or loyalty column on ' + MAIN_SHEET_NAME + '.');
  }

  const rows = [['icon', 'aspect', 'loyalty']];
  for (let r = 1; r < data.length; r++) {
    const raw = String(data[r][iconCol] || '').trim();
    if (!raw) continue;
    const aspect = data[r][aspectCol];
    const loyalty = data[r][loyaltyCol];
    raw.split('/').map(s => s.trim()).filter(Boolean).forEach(icon => {
      rows.push([icon, aspect, loyalty]);
    });
  }

  let out = ss.getSheetByName(ICON_BREAKDOWN_SHEET_NAME);
  if (!out) out = ss.insertSheet(ICON_BREAKDOWN_SHEET_NAME);
  out.clearContents();
  out.getRange(1, 1, rows.length, 3).setValues(rows);
  Logger.log('buildIconBreakdown: wrote ' + (rows.length - 1) + ' icon-instance rows to "' + ICON_BREAKDOWN_SHEET_NAME + '".');
}

// RUN THIS whenever you want the pair-count table refreshed. For Lieutenants and Allies
// separately, covers every distinct pair of real (non-Neutral) aspects present, crossed
// with each loyalty value: counts how many DISTINCT-card pairs (never a card paired with
// itself) — eligible under real aspect rules (either of the two chosen aspects, or
// Neutral, always allowed) — have combined cost exactly 10.
const PAIR_COUNTS_SHEET_NAME = 'PairCounts';
function buildAllyLieutenantPairCounts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName(MAIN_SHEET_NAME);
  const data = mainSheet.getDataRange().getValues();
  const headers = data[0];
  const typeCol = headers.indexOf('type');
  const aspectCol = headers.indexOf('aspect');
  const loyaltyCol = headers.indexOf('loyalty');
  const costCol = headers.indexOf('card-cost');
  if ([typeCol, aspectCol, loyaltyCol, costCol].indexOf(-1) !== -1) {
    throw new Error('Could not find type, aspect, loyalty, or card-cost column on ' + MAIN_SHEET_NAME + '.');
  }

  const configs = [
    { type: 'O - Lieutenant', label: 'Lieutenant' },
    { type: 'C - Ally', label: 'Ally' },
  ];
  const isNeutral = (a) => /neutral/i.test(a);
  const rows = [['Type', 'Aspect 1', 'Aspect 2', 'Loyalty', 'Pair Count (cost sums to 10)']];

  configs.forEach(cfg => {
    const cards = [];
    for (let r = 1; r < data.length; r++) {
      if (data[r][typeCol] !== cfg.type) continue;
      const cost = Number(data[r][costCol]);
      if (isNaN(cost)) continue;
      cards.push({
        aspect: String(data[r][aspectCol] || '').trim(),
        loyalty: String(data[r][loyaltyCol] || '').trim(),
        cost: cost,
      });
    }

    const realAspects = Array.from(new Set(cards.map(c => c.aspect).filter(a => a && !isNeutral(a))));
    const loyalties = ['Standard', 'Loyal'];

    for (let i = 0; i < realAspects.length; i++) {
      for (let j = i + 1; j < realAspects.length; j++) {
        const a1 = realAspects[i], a2 = realAspects[j];
        loyalties.forEach(loy => {
          const eligible = cards.filter(c =>
            c.loyalty === loy && (c.aspect === a1 || c.aspect === a2 || isNeutral(c.aspect))
          );
          let pairCount = 0;
          for (let x = 0; x < eligible.length; x++) {
            for (let y = x + 1; y < eligible.length; y++) {
              if (eligible[x].cost + eligible[y].cost === 10) pairCount++;
            }
          }
          rows.push([cfg.label, a1, a2, loy, pairCount]);
        });
      }
    }
  });

  let out = ss.getSheetByName(PAIR_COUNTS_SHEET_NAME);
  if (!out) out = ss.insertSheet(PAIR_COUNTS_SHEET_NAME);
  out.clearContents();
  out.getRange(1, 1, rows.length, 5).setValues(rows);
  Logger.log('buildAllyLieutenantPairCounts: wrote ' + (rows.length - 1) + ' rows to "' + PAIR_COUNTS_SHEET_NAME + '".');
}

// Each GAME has its own help content now, rather than one shared "Help" tab living in
// (and read out of) Set 1's own bound sheet: a Google Sheet named "Help" (matched by
// name, same "card" folder-matching approach as findCardArtFolder — case-insensitive,
// so "Help", "Help.gsheet", "HellBreak Help", etc. all work) sits directly in the
// game's own main folder, alongside its card backs and .pcio file. Its "Sheet1" tab
// holds the articles: column A = article title, column B = article content, one
// article per row (row 1 is the header row and is skipped). Blank-title rows are
// skipped too, so stray formatting/spacer rows don't show up as empty articles.
// Never throws — a missing Help sheet (or missing gameFolderId) just means no
// articles, exactly as if the Help tab used to be empty.
function findHelpSheetFile(gameFolderId) {
  if (!gameFolderId) return null;
  try {
    const folder = DriveApp.getFolderById(gameFolderId);
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const f = files.next();
      if (/help/i.test(f.getName())) return f;
    }
  } catch (err) {
    // game folder missing/inaccessible -> no help file found
  }
  return null;
}
function getHelpArticles(gameFolderId, callback) {
  let articles = [];
  const helpFile = findHelpSheetFile(gameFolderId);
  if (helpFile) {
    const ss = SpreadsheetApp.openById(helpFile.getId());
    const sheet = ss.getSheetByName('Sheet1');
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      articles = data.slice(1)
        .filter(row => row[0])
        .map(row => ({ title: String(row[0]), content: String(row[1] || '') }));
    }
  }
  const json = JSON.stringify(articles);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// No doPost here — this script no longer handles any game-session writes.
// Game events (play.html) are served entirely by a separate spreadsheet +
// Apps Script project now; this one is scoped to card data only.
