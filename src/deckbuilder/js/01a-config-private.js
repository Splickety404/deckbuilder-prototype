/* =========================================================================
   PRIVATE CONFIG — the Google/Drive backend and sign-in (private build only)
   ========================================================================= */
// No Google Sheet id is hardcoded here. Which sets exist, and which of them this signed-in
// user can see, is decided entirely by the server (Code.gs), based on live Google Drive
// folder-sharing permissions — this file never maintains its own access list.
// WEBAPP_URL is the deckbuilder's own Apps Script deployment — reusable infrastructure,
// not a specific spreadsheet — so it is the only endpoint that may stay hardcoded.
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxuoxW84Mn4Grrq2T9_RCoCJO1ftMdBPJ2gNqcwW5T7wXNonNjZaKOcxgc3ZQAHanVpZQ/exec';
// Google OAuth Client ID — not a secret, meant to sit in client-side code. Must match the
// OAUTH_CLIENT_ID constant in Code.gs so the server accepts ID tokens minted for this app.
const GOOGLE_CLIENT_ID = '1053912607552-pvrm9heedm4floaohv1olp5k5mdp95lq.apps.googleusercontent.com';
state.idToken = ''; // Google ID token from Sign In With Google — sent with every data request so the server can check Drive permissions
state.userEmail = ''; // signed-in user's email, from the server's whoami response (not decoded client-side)
