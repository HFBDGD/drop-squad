# Drop Squad

A fast, friendly browser game for kids — descend the endless mine shaft, dodge the spikes, and don't get squished against the ceiling. A modern, Minecraft-styled homage to the classic **NS-SHAFT**.

Built with [Phaser 3](https://phaser.io). Runs entirely in the browser — no install, no account.

## Play

▶ **[Play here](https://hfbdgd.github.io/drop-squad/)**

## Modes

| Mode | Controls |
|------|----------|
| **1 Player** | `←` `→` to move |
| **2 Players (local)** | P1 `←` `→` · P2 `A` `D` |
| **Play Online** | One player hosts and shares a 6-letter room code; a friend joins with it. Both race down the same shaft. |

Menus are fully keyboard-driven: `↑` `↓` to navigate, `ENTER` to select, `ESC` to go back.

## Platforms

- **Grass** — safe landing
- **Wood** — holds you for 1 second, then drops you through
- **Netherrack (fire)** — hurts on contact
- **Slime** — bounces you back up
- **Ice (conveyor)** — slides you left or right

Survive longer to score higher. The shaft speeds up the deeper you go.

## Run locally

```bash
cd ns-shaft
python3 -m http.server 8765
# open http://localhost:8765
```

To play across devices on the same Wi-Fi, point a phone or tablet at `http://<your-computer-ip>:8765`.

## Online multiplayer

Online play uses [Supabase Realtime](https://supabase.com/realtime) broadcast channels (pub/sub only — no data is stored). The publishable anon key in `config.js` is safe to expose: it belongs to a dedicated, empty Supabase project used solely for this game's realtime channels. It is fully isolated from any other project and contains no data, so there is nothing for the key to protect.

## Tech

- Phaser 3 (via CDN)
- Supabase JS (via CDN) for realtime
- No build step — plain HTML + JS, deployable as static files

## Credits

Inspired by **NS-SHAFT** by NAGI-P SOFT. All code and artwork here are original.

## License

MIT — see [LICENSE](LICENSE).
