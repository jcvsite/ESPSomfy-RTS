# Changelog

Fork of [rstrouse/ESPSomfy-RTS](https://github.com/rstrouse/ESPSomfy-RTS) **v2.4.7**, targeted at **large villas** (high shade/room counts, mesh Router + Repeaters). Web UI ships **English** (additional languages possible via locale files); the matching HA integration already has multi-language translations. Incorporates selected fixes from other community forks — see README [Credits](README.md#credits).

Hardware setup, pairing, and MQTT basics: [original wiki](https://github.com/rstrouse/ESPSomfy-RTS/wiki).

Matching Home Assistant component: [jcvsite/ESPSomfy-RTS-HA](https://github.com/jcvsite/ESPSomfy-RTS-HA).

---

## v3.4.5 — 2026-08-16

Initial public release of this fork (**firmware / Web UI 3.4.5**, board `esp32dev`, 4 MB OTA map).

**Breaking flash map:** first install from the original or any other fork needs a **USB / full flash** (new partition table). Web Manual Update and GitHub OTA from those builds are **not** supported. **Backup import is supported** — export a `.backup` before flashing and Restore after; shade/room/group config carries over. After migration, web `.espsomfy` updates work only between releases of this fork. Prefer [ESPHome Web](https://web.esphome.io/) + the versioned onboard zip, or PlatformIO `upload` / `uploadfs` — see README.

### Capacity, mesh, and villa features
- **v2 → v3 flash map** (USB once): app 1.75 MB × 2, LittleFS 448 KB. Web OTA cannot rewrite the partition table.
- Mesh **Router + Repeaters** (up to 4 extra radios), room Auto routing by linked-remote RSSI, failover if a slave is offline.
- Higher capacity: **48 shades / 24 rooms**, **11** linked remotes per shade.
- Scenes (up to 8) and NTP schedules (up to 8); FixedCode learn/TX for 433 MHz ON/OFF remotes.
- Configuration backup/restore includes RF switches, scenes/schedules, mesh, and system settings (including Alexa Hue bridge + per-shade expose flags).
- **RF command queue:** room Open/Close/My and scenes enqueue all motors on the device (up to 48); Home Assistant room covers / `apply_scene` use the same path (no 12/24 truncation).
- Motor-control fixes: classic My stop (3 frames), invert scale (100% open / 0% closed), ignore self-TX echo, reverse-while-moving sends My first.
- Modern Home / Settings UI (themes, density, search, favorites); English locale shipped.
- Single `.espsomfy` Manual Update package for in-fork updates.

### OTA and reliability
- Manual Update returns as soon as the new filesystem mounts; shade restore and reboot continue on the device.
- Successful OTA marks the app valid early so the bootloader does not roll back on the next reboot.
- Shade/room heap is allocated after mark-valid (avoids constructor OOM that looked like a successful flash then rolled back).
- Failed/aborted LittleFS updates remount or reformat and rewrite shades/rooms/scenes from RAM when possible; remount accepts gzipped UI paths.
- If firmware flashed but the filesystem stage fails, the boot slot rolls back to the previous firmware (no new FW + empty FS).
- Application update remounts and rewrites shade data **before** reboot on success; remount refuses an FS image without a usable `/index.html`.
- Manual FS update sets `lockFS` and skips RF/mesh/fixed-code loops while flashing.
- GitHub OTA stops radio and MQTT like Manual Update; does not report success on download/`Update.end` failure; success toast only after `fwStatus` COMPLETE with error 0.
- Configuration backup required before GitHub and Manual Update (mobile and desktop).
- Manual Update shows package vs device versions and confirms before installing an older package; UI version from device `/appversion`.

### Settings and Home UI
- Settings hub: Home / Controller groups, tinted icons, sidebar rail, mobile section tabs.
- Network: Connection + IP together; MQTT on its own tab; inline DHCP/Static editor.
- Mesh Repeaters/Activity, Radio (frequency scan), Devices, RF TX debug, and empty-home welcome redesigned to the same panel layout.
- Compact Add Room / Add Device / pairing; Devices subtabs scroll on mobile; footers stay above bottom nav.
- Radio enable toggle visibility; Transceiver vs RF log labeling; RSSI frame count separate from dBm.
- Dark-mode contrast for “my” badge and Radio controls; Frequency Scan applies best frequency on Stop.
- Compact Home: single-row shade list, larger Up/My/Down targets, position bar, compact ⋯ menu; header shows firmware version.
- Firmware page lists CC1101 and library versions; Manual Update GitHub tab visible on desktop Settings.

### Release assets
- Versioned GitHub release names are primary (e.g. `SomfyController.onboard.esp32-v3.4.5.bin.zip`, `…-v3.4.5.espsomfy`, `…-v3.4.5.bin`). Legacy unversioned aliases may still be uploaded for older controllers of this fork.
- GitHub OTA prefers the versioned asset and falls back to the legacy name if needed.

### Alexa (optional, no Home Assistant)
- Router can emulate a Philips Hue bridge for Alexa. Configure under **Network → Alexa** (master toggle + shade list, max 24). Lights: on/off + brightness → open/close + position. Prefer HA Cloud Alexa when using Home Assistant.
