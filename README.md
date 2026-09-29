# cs1.6-fun

A Counter-Strike 1.6 style FPS you play solo against bots. Three.js in the browser, or a Windows exe via Electron.

## Play

```
./play.sh
```

Builds, serves on http://localhost:4173 and opens your browser (the Windows one when run from WSL, which gets the real GPU). Click to play, F11 for fullscreen. The Esc menu has settings and a New game panel for map, mode, team, bot counts and bot skill.

For the desktop build, grab `cs1.6-fun-<version>.exe` from the latest GitHub release (push a `v*` tag to make one), or run `npm run desktop` locally. Pass `--uncapped-fps` to the exe to turn off vsync, and `--windowed` to start windowed.

## Controls

WASD move, Space jump, Ctrl duck, Shift walk (silent), Mouse1 fire, Mouse2 scope/silencer/burst/knife stab, R reload, B buy menu (number keys), 1-5 weapon slots (4 again cycles grenades), Q last weapon, mouse wheel cycle, G drop, E defuse, Z/X/C radio menus (your bots follow them: follow me, hold, go A/B, regroup, fall back...), Tab scores.

Sensitivity uses 1.6's scale (0.022 deg per count), so your old `sensitivity` value carries over. Raw input is on by default.

## What's in it

- GoldSrc movement: air strafing, 1.6 landing penalty on bhops, duck-jumps, 18u steps, walk/crouch speeds, tagging when shot.
- The 1.6 arsenal with KickBack recoil tables, shots-fired and movement inaccuracy, hitgroups, armor penetration, wallbangs, scoped snipers, knife backstabs, HE/flash/smoke.
- Bomb defusal with 1.6 economy (loss bonus, $16000 cap, plant bonus), buy menu, halftime swap. Deathmatch as well.
- Bots with generated navigation, human-like aim and reaction times, site takes, holds, rotations, retakes, buying and grenades. Skill presets: easy, normal (~Silver), hard (~Gold Nova), expert.
- Maps: de_dust2 and de_cache style layouts from memory, and aim_arena.

## Play with friends

One person hosts a dedicated server (bots fill the empty slots):

```
./play.sh host              # de_dust2, bomb defusal
./play.sh host de_mirage dm # any map, deathmatch
```

It prints addresses like `http://192.168.1.20:27015/?connect`. These private addresses work on the host’s local network. Friends on another network need a public address with TCP port 27015 forwarded, or an HTTPS tunnel link. Under WSL, LAN friends need WSL’s mirrored networking or a Windows port proxy.

The Join menu accepts HTTP, HTTPS, and WebSocket links. Connections that do not complete the game handshake show an error after ten seconds, with a link back to the menu.

### Friends on another network

```sh
npm run share -- --map de_dust2 --mode dm
```

This builds the game, starts the server, and prints a **FRIEND LINK** such as `https://example.trycloudflare.com/?connect`. Send that link to your friend; keep the terminal open while you play. The helper downloads the official `cloudflared` tool into `.host-tools/` on first use and reuses it afterward. You can play through the **YOUR LOCAL LINK** shown alongside it. Ctrl+C stops both the server and tunnel.

The [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) uses a temporary address that changes when restarted. It supports this game's [WebSocket connection](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/). For direct hosting, forward TCP port 27015 to your hosting computer and share your public IP instead. Full HTTP/HTTPS links also work in the Join menu; unreachable connections show an error after ten seconds.

After building once, `npm run share:built -- --map de_dust2 --mode dm` reuses the existing build. Set `CLOUDFLARED` to use a specific installed executable.

The server is authoritative at 100 ticks per second and sends 30 snapshots a second. Your own movement is predicted and replayed, and other players are drawn 100ms behind. There's no lag compensation yet, so on high ping you'll need to lead moving targets.

## Real 1.6 sounds

The game synthesizes every sound, but if you own Counter-Strike 1.6 you can use its originals:

```
mkdir -p public/sounds
cp -r "<Steam>/steamapps/common/Half-Life/cstrike/sound" public/sounds/cstrike
./play.sh
```

Guns, footsteps, hits, knife, C4, grenades and the radio voice lines all pick up the matching files; anything missing falls back to synthesis. `public/sounds/` is gitignored, so Valve's files never end up in the repo. The browser console says how many files it loaded.

## Develop

```
npm run dev        # Vite dev server
npm test           # unit tests, including headless bot-vs-bot matches
npm run typecheck
node scripts/shot.mjs out.png "map=de_cache&team=spec&nomenu" 20000   # headless screenshot
node scripts/smoke.mjs 'fire&give=ak47'                                # boot and fail on page errors
```

Useful URL params: `?mapview=de_dust2&nav` (top-down layout with bot routes and hold spots), `?team=spec` (watch bots), `?pos=x,y,z&yaw=&pitch=` (noclip camera), `?give=awp,deagle`, `?debug` (exposes `window.app`).

Maps are TypeScript in `src/maps/`, built with `Carver` (declare walkable rooms, everything else becomes wall) plus boxes, ramps and stairs.
