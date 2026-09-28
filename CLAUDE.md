# Echo of Omens — deckbuilder-prototype

Browser tools for the Echo of Omens card game (and HellBreak, a second game in the same deckbuilder). This repo is **public** and served by GitHub Pages — everything committed here is world-readable. Never commit secrets, private links, or unannounced game/set names.

## Files

- `deckbuilder.html` — the live deckbuilder app (single self-contained HTML file). Multi-game; Overlord, Champion, and Scheme deck types; print-and-play PDF and playingcards.io export.
- `room.html` — 2-player remote play companion (Champion vs Overlord). Syncs only public board actions via the backend event log; hands/decks stay local. A visual aid, not a rules engine.
- `bagel.html` — separate tool, also served publicly.
- `Code.gs` — **mirror only** of the Apps Script backend. The live backend is a separate Apps Script project; changes are deployed there by creating a new version of the *existing* deployment (keeps the Web app URL). Editing this file does not deploy anything — keep it in sync by hand.
- `index.html` — Pages entry point (see below).

## Deployment

- GitHub Pages serves `main` at https://splickety404.github.io/deckbuilder-prototype/ (the old `echo-of-omens-deckbuilder` Pages URL stopped working after the repo rename).
- `WEBAPP_URL` in `deckbuilder.html` must match the live Apps Script deployment URL.
- Card data comes from a Google Sheet + Drive art, served through the Apps Script Web App.

## Key design decisions

- Access control: Google Sign-In gates the app; authorization comes from Drive folder sharing per card set (one folder = one set's Sheet + art). Deckbuilder first; `room.html` to follow.
- The "request access" form uses **plain-text fields on purpose** — never dropdowns — so it can't be used to enumerate which games/sets exist. The `requestAccess` endpoint is intentionally ungated.
- Filters are separate per view: `state.filtersByType` has `overlord`, `champion`, and `scheme` keys, chosen by `activeFilterKey()`. The Scheme card *pool* still derives from the chosen Overlord + Domination cards.

## Working conventions

- Seth is a game designer with light coding experience — explain changes conceptually, not with jargon.
- Ask before building complex rule changes; write pseudocode first for anything nontrivial; keep each change narrow (one function or mechanic).
- When naming new mechanics, flag keyword collisions with existing ones.
- Keep tools as single self-contained HTML files. Validate JS syntax (e.g. extract the script and run `node --check`) before committing.
- Ask before pushing to `main` — it deploys live to Pages.
