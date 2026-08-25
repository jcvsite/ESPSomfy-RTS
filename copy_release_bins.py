"""Post-build: copy firmware/filesystem bins to web-uploader names + pack .espsomfy."""

import os
import struct
import shutil

from SCons.Script import Import

Import("env")

# PIO env name -> SomfyController.ino.<suffix>.bin (matches GitOTA::setFirmwareFile)
_FW_SUFFIX = {
    "esp32dev": "esp32",
    "esp32dev-cc1101v257": "esp32",
    "esp32wrover": "esp32wrover",
    "esp32c3": "esp32c3",
    "esp32s2": "esp32s2",
    "esp32s3_4mb": "esp32s3_4mb",
    "esp32s3_8mb": "esp32s3_8mb",
}

# Chip id in .espsomfy header (must match data-dev/index.js ESPSOMFY_CHIP_IDS)
_CHIP_IDS = {
    "esp32": 0,
    "esp32wrover": 1,
    "esp32c3": 2,
    "esp32s2": 3,
    "esp32s3_4mb": 4,
    "esp32s3_8mb": 5,
}

# OTA app slot size (must match partitions/*.csv)
_APP_PART = {
    "esp32dev": 0x1C0000,
    "esp32dev-cc1101v257": 0x1C0000,
    "esp32wrover": 0x1C0000,
    "esp32c3": 0x1C0000,
    "esp32s2": 0x1C0000,
    "esp32s3_4mb": 0x1C0000,
    "esp32s3_8mb": 0x300000,
}


def _copy(src: str, dst: str) -> None:
    if not os.path.isfile(src):
        return
    shutil.copy2(src, dst)
    print(f"[release-bin] {os.path.basename(dst)}  ({os.path.getsize(dst)} bytes)")


def _read_app_version(proj_dir: str) -> str:
    for rel in ("data/appversion", "data-dev/appversion"):
        path = os.path.join(proj_dir, rel)
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read().strip()
            v = raw.splitlines()[0].strip() if raw else ""
            if v:
                return v if v.lower().startswith("v") else f"v{v}"
    return ""


def _pack_espsomfy(build_dir: str, suffix: str, pioenv: str) -> None:
    """Write SomfyController.<suffix>.espsomfy when both bins exist."""
    fw_path = os.path.join(build_dir, f"SomfyController.ino.{suffix}.bin")
    fs_path = os.path.join(build_dir, "SomfyController.littlefs.bin")
    if not (os.path.isfile(fw_path) and os.path.isfile(fs_path)):
        return

    with open(fw_path, "rb") as f:
        fw_data = f.read()
    with open(fs_path, "rb") as f:
        fs_data = f.read()

    chip_id = _CHIP_IDS.get(suffix, 0)
    flags = 0x03  # bit0=FW, bit1=FS
    header = bytearray(32)
    header[0:8] = b"ESPSOMFY"
    struct.pack_into("<HBBII", header, 8, 1, chip_id, flags, len(fw_data), len(fs_data))
    # Bytes 20-31: null-padded version (e.g. v3.4.4) for Manual Update UI.
    ver = _read_app_version(env.subst("$PROJECT_DIR"))
    if ver:
        vb = ver.encode("ascii", "ignore")[:12]
        header[20 : 20 + len(vb)] = vb

    app_part = _APP_PART.get(pioenv, 0x1C0000)
    if len(fw_data) > app_part:
        print(f"[release-bin] ERROR: firmware {len(fw_data)} bytes exceeds OTA partition {app_part}")
        return

    out = os.path.join(build_dir, f"SomfyController.{suffix}.espsomfy")
    with open(out, "wb") as f:
        f.write(header)
        f.write(fw_data)
        f.write(fs_data)
    print(f"[release-bin] {os.path.basename(out)}  ({os.path.getsize(out)} bytes){f'  ver={ver}' if ver else ''}")


def copy_firmware_bin(source, target, env):
    build_dir = env.subst("$BUILD_DIR")
    pioenv = env.subst("$PIOENV")
    suffix = _FW_SUFFIX.get(pioenv, "esp32")
    _copy(
        os.path.join(build_dir, "firmware.bin"),
        os.path.join(build_dir, f"SomfyController.ino.{suffix}.bin"),
    )
    _pack_espsomfy(build_dir, suffix, pioenv)


def copy_filesystem_bin(source, target, env):
    build_dir = env.subst("$BUILD_DIR")
    pioenv = env.subst("$PIOENV")
    suffix = _FW_SUFFIX.get(pioenv, "esp32")
    for name in ("littlefs.bin", "spiffs.bin"):
        src = os.path.join(build_dir, name)
        if os.path.isfile(src):
            _copy(src, os.path.join(build_dir, "SomfyController.littlefs.bin"))
            _pack_espsomfy(build_dir, suffix, pioenv)
            return


env.AddPostAction("$BUILD_DIR/firmware.bin", copy_firmware_bin)
# Filesystem image is produced by `pio run -t buildfs` / uploadfs
env.AddPostAction("$BUILD_DIR/littlefs.bin", copy_filesystem_bin)
