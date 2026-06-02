// ─────────────────────────────────────────────────────────
//  Drop Squad — runtime config
//
//  These are Supabase PUBLISHABLE (anon) credentials for a
//  DEDICATED, EMPTY project ("public-apps") used only for this
//  game's realtime multiplayer. It contains no data and is fully
//  isolated from any production project, so exposing this key in
//  a public repo is harmless by design.
//
//  Online play uses ephemeral realtime broadcast channels only —
//  nothing is read from or written to the database.
//
//  To use your own Supabase project, swap these two values.
// ─────────────────────────────────────────────────────────
window.GAME_CONFIG = {
  SB_URL:  'https://bqyldkbfygzkvotbvilz.supabase.co',
  SB_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxeWxka2JmeWd6a3ZvdGJ2aWx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDExMzQsImV4cCI6MjA5NTk3NzEzNH0.41ScU6QXX-l_pHwyRJr4HD4o-yrjSY008qWWNNc0AIM',
};
