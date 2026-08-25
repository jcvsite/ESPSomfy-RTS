# ESPSomfy-RTS

Fork of [rstrouse/ESPSomfy-RTS](https://github.com/rstrouse/ESPSomfy-RTS) (v2.4.7), aimed at **large villas and multi-building homes**: dozens of motors, several rooms, and RF coverage beyond a single ESP32. Same ESP32 + CC1101 hardware for Somfy RTS / RTW / RTV 433 MHz.

This tree adds mesh radios (Router + Repeaters), **48 shades / 24 rooms**, scenes and schedules, fleet OTA, a redesigned Settings/Home UI (ships **English**; additional UI languages are possible via locale files), motor-control fixes, and selected bug fixes from other community forks.

Web UI: **English** in this release (multi-language locale packs can be added later). The matching Home Assistant integration already ships **multiple translations**. Hardware build, pairing, and MQTT: [original wiki](https://github.com/rstrouse/ESPSomfy-RTS/wiki). Release notes: [CHANGELOG.md](CHANGELOG.md).

[![GitHub Release](https://img.shields.io/github/release/jcvsite/ESPSomfy-RTS.svg?style=for-the-badge)](https://github.com/jcvsite/ESPSomfy-RTS/releases)
[![License](https://img.shields.io/github/license/jcvsite/ESPSomfy-RTS.svg?style=for-the-badge)](LICENSE)

**Firmware v3.4.5** · target `esp32dev` (4 MB OTA partition map) · **SmartRC-CC1101 Driver Lib 3.0.2** (latest; fallback env for 2.5.7 available)

> **First install requires a USB / full flash.** This release uses a different partition table than the original firmware and other forks. You **cannot** install or upgrade to it via web Manual Update / GitHub OTA from rstrouse, xkain, or other community builds — that would brick or leave an inconsistent flash map. Shade config is not lost if you use Backup/Restore: export a `.backup` first, USB-flash once, then **import the backup** on the new firmware. After that, use web `.espsomfy` only between builds of **this** fork.

### Architecture (original vs this fork)

![ESPSomfy-RTS architecture vs the original](images/espsomfy-architecture-vs-original.png)

### Features (original vs this fork)

![ESPSomfy-RTS features vs the original](images/espsomfy-features-vs-original.png)

**Repository:** [github.com/jcvsite/ESPSomfy-RTS](https://github.com/jcvsite/ESPSomfy-RTS)

## Why this fork

A single radio often cannot cover a large property. This firmware treats one ESP as the **Router** (shades, HA, MQTT, UI) and optional **Repeaters** as extra transmitters on the LAN, with room-level Auto routing to the best radio. Capacity, an on-device **RF command queue** (room Open/Close/My and scenes for all motors), and schedules are sized for villa-scale installs rather than a few living-room blinds.

It also merges useful fixes from upstream PRs and other forks. See [Credits](#credits).

## What changed vs the original

| | Original (v2.4.7) | This fork |
|---|---|---|
| Shades / rooms | 32 / 16 (30 / 14 usable IDs) | **48 / 24** (all usable) |
| Radios | One ESP32 + CC1101 | **Router + up to 4 Repeaters** on the LAN |
| Which radio transmits | The one ESP | Every radio until a paired remote is heard; then the loudest (failover if offline) |
| Repeater config | — | Router pushes timezone, NTP, and login; Repeater names are edited on the Router |
| Mesh fleet OTA | — | Router pushes firmware / LittleFS to online Repeaters |
| Scenes | — | Up to **8** named scenes (capture room positions, run from Home) |
| Schedules | — | Up to **8** NTP time-of-day rules (room or scene) |
| Room / scene actions | Per-shade or truncated batches | On-device **RF command queue** — Open / My / Close all and scenes enqueue every motor (up to **48**), no 12/24 cut-off |
| Web UI | Multi-language desktop UI | Redesigned Settings/Home; **English** shipped (extra languages possible via locales) |
| Position scale | Motor-native | **100% open / 0% closed** (matches Home Assistant) |
| Invert / calibrate | Limited | Invert % synced to the ESP; travel times; calibrate without moving (HA too) |
| Stop mid-travel | My / 80-bit Stop (unreliable on many curtains) | Classic My, 3 frames, ignore self-TX echo |
| Linked remotes | 7 per shade | **11** per shade |
| RF switches | — | Learn / TX 433 MHz ON/OFF remotes |
| Update / flash map | Separate bins; stock partition table | **New 4 MB OTA map** (1.75 MB × 2 app, 448 KB LittleFS). First install = **USB only**; no web/Manual Update from original or other forks. Later updates: `.espsomfy` on this fork only |
| Home Assistant | Basic open / stop / close | Matching [ESPSomfy-RTS-HA](https://github.com/jcvsite/ESPSomfy-RTS-HA) |

Unchanged: ESP32 + CC1101 hardware, Somfy pairing, MQTT topics, and the original wiki for wiring and first setup.

### Mesh
One **Router** holds shades, Home Assistant, MQTT, and the web UI. **Repeaters** are extra radios only — no shade list, HA, or MQTT.

First-run wizard: Router or Repeater. Pair Repeaters with the Router login password. A device that already has shades becomes Router automatically.

On Mesh → Repeaters, each room can be **Auto (best radio)** or locked to This unit / a Slave. Auto picks the strongest radio that heard a **linked** remote (≥ −85 dBm). Link the physical Somfy remote on the shade for Auto and Activity naming.

### Motor control and RF queue
Stop actually stops. Reverse while moving sends My first. HA/UI My while the motor is running sends `stop`, not favorite. Self-transmitted Up/Down echoes are ignored so estimated position does not jump to 0% / 100%.

Room Open / My / Close and scenes do not fire motors one-at-a-time from the browser. The Router holds an **on-device RF queue** and transmits each shade in turn (up to 48), so a large villa is not truncated at the old 12/24 limits. Home Assistant room covers and `apply_scene` use the same queue.

## Install / update

### Coming from original or another fork (USB required)

This fork’s partition table is **not** compatible with the original or other forks. Web Manual Update and GitHub OTA **cannot** rewrite the table at `0x8000`.

- Do **not** upload a v3 `.espsomfy` (or firmware/LittleFS bins) onto a device still running rstrouse, xkain, or any other non-v3 map.
- Do **not** expect those firmwares’ web updaters to install this release.
- First migration: **Backup** (`.backup` export) → USB flash (partition + firmware + filesystem) → **Restore / import** the same backup. Shades, rooms, groups, and remote addresses come back. After that, web updates work for **this fork’s** packages only.

### USB migration (once)

v3 moves the flash map (firmware slots 1.75 MB, LittleFS 448 KB).

1. Web UI → **Backup** (save the `.backup` file).
2. USB, **no full erase** (keeps Wi‑Fi in NVS):

```bash
python -m platformio run -t upload -e esp32dev
python -m platformio run -t buildfs -t uploadfs -e esp32dev
```

3. The device should rejoin the same LAN. **Restore** the backup.
4. Repeaters need the same USB pair. After that, web `.espsomfy` works again **within this fork**.

#### USB flash with ESPHome Web (no PlatformIO)

Chrome or Edge only (Web Serial). Good for migration and blank/factory chips.

1. On the **current** firmware: **Backup** and save the `.backup` file (skip on a blank chip).
2. Download the **versioned** onboard zip for your chip from this fork’s GitHub **Releases**, e.g. `SomfyController.onboard.esp32-v3.4.5.bin.zip` (tag in the filename).
3. Unzip it — you need the inner `SomfyController.onboard.bin` (bootloader + partitions + firmware + LittleFS).
4. Open [ESPHome Web](https://web.esphome.io/), connect the board over USB, and install that **custom** `.bin` (do **not** install ESPHome firmware). Prefer **no full erase** if offered, so Wi‑Fi credentials in NVS can survive.
5. After reboot, open the device web UI and **Restore** the `.backup`.

Use the matching asset for your board (`esp32`, `esp32c3`, `esp32s3_4mb`, …) and the release tag you want. Do **not** flash `.espsomfy` here — that is only for Manual Update after you are already on this fork’s v3 partition map. The onboard image rewrites LittleFS; shades come back only via Restore.

### Later updates on this fork (web)

Already on this fork’s v3 map? Use Manual Update:

```bash
python -m platformio run -e esp32dev
python -m platformio run -t buildfs -e esp32dev
```

Web UI → Firmware → **Manual Update** → Local file:

```text
.pio/build/esp32dev/SomfyController.esp32.espsomfy
```

Default `esp32dev` builds with the **latest** SmartRC-CC1101 Driver Lib (**3.0.2**). Fallback build with **2.5.7** if needed:

```bash
python -m platformio run -e esp32dev-cc1101v257
python -m platformio run -t buildfs -e esp32dev-cc1101v257
```

Legacy: `SomfyController.ino.esp32.bin` (firmware) and `SomfyController.littlefs.bin` (application). Prefer the web updater for the application part — USB `uploadfs` wipes LittleFS (shades). Download **Backup** first if you must flash the filesystem over USB.

GitHub releases publish **versioned** assets as the primary names (e.g. `SomfyController.onboard.esp32-v3.4.5.bin.zip`, `…-v3.4.5.espsomfy`, `…-v3.4.5.bin`). Legacy unversioned aliases may still be uploaded for older controllers **of this fork**.

Flash both Router and Repeaters with the same `.espsomfy` when mesh behavior changes.

GitHub OTA is **off** by default. Enable it only after you publish releases on this fork. Cross-fork / original ↔ this map remains USB-only.

## Home Assistant

Use the matching integration: [jcvsite/ESPSomfy-RTS-HA](https://github.com/jcvsite/ESPSomfy-RTS-HA) **v2.6.1** (invert, travel times, calibrate, cover pictures, FixedCode, room covers, scenes, reliable Stop). That component includes **multi-language** Home Assistant translations (e.g. en / de / es / fr).

### Alexa / voice

- **With Home Assistant:** enable HA Cloud Alexa (or a manual Alexa Smart Home skill), expose `cover.*` entities, then discover devices in the Alexa app. Covers appear as Interior/Exterior Blind by shade type. Prefer this path when you use HA.
- **Without Home Assistant:** on the **Router**, Network → **Alexa** → enable the Hue bridge, then toggle shades in the list (max 24). Alexa discovers dimmable **lights** — say “turn on Kitchen Window” / set brightness. Re-discover after changing the list. Do not use Hue and HA Alexa for the same shades.

The original [rstrouse/ESPSomfy-RTS-HA](https://github.com/rstrouse/ESPSomfy-RTS-HA) still does basic open / stop / close only.

## Hardware and pairing

Unchanged from the original:

- [Simple hardware guide](https://github.com/rstrouse/ESPSomfy-RTS/wiki/Simple-ESPSomfy-RTS-device)
- [Installing the firmware](https://github.com/rstrouse/ESPSomfy-RTS/wiki/Installing-the-Firmware)
- [Configuring the software](https://github.com/rstrouse/ESPSomfy-RTS/wiki/Configuring-the-Software)
- [Integrations](https://github.com/rstrouse/ESPSomfy-RTS/wiki/Integrations)

IO Home Control is not native. GPIO / dissected-remote options are in the original wiki.

## Restore / import backups

USB reflash changes the partition map; it does **not** require re-pairing every motor from scratch if you import a backup.

- **From this fork or rstrouse v2.4.x:** Web UI → **Backup** before flashing, then **Restore** after. Shades, groups, rooms, and remote addresses load from the `.backup` file.
- After import, confirm radio GPIOs on the Radio tab if the board selector does not match your wiring.
- Prefer Backup/Restore over relying on LittleFS surviving `uploadfs` (USB filesystem flash wipes shade files).

## Credits

Built on [rstrouse/ESPSomfy-RTS](https://github.com/rstrouse/ESPSomfy-RTS). Earlier UI/PlatformIO work from [xkain/ESPSomfy-RTS](https://github.com/xkain/ESPSomfy-RTS).

Matching Home Assistant integration: [jcvsite/ESPSomfy-RTS-HA](https://github.com/jcvsite/ESPSomfy-RTS-HA).
