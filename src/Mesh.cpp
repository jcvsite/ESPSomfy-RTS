/**
 * Mesh.cpp — LAN mesh Router/Repeater: peer discovery, radio handoff, sync, and fleet OTA helpers.
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <ETH.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_task_wdt.h>
#include "mbedtls/md.h"
#include "Mesh.h"
#include "ConfigFile.h"
#include "ConfigSettings.h"
#include "Network.h"
#include "Utils.h"

extern ConfigSettings settings;
extern SomfyShadeController somfy;
extern Network net;

MeshController mesh;
static WiFiUDP meshUdp;
static bool meshUdpOn = false;
static const char *meshKey = nullptr;

static void sha256(const uint8_t *d, size_t n, uint8_t out[32]) {
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, d, n);
  mbedtls_md_finish(&ctx, out);
  mbedtls_md_free(&ctx);
}
static void hmac256(const uint8_t key[32], const uint8_t *d, size_t n, uint8_t out[32]) {
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, key, 32);
  mbedtls_md_hmac_update(&ctx, d, n);
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
}
static void toHex(const uint8_t *b, size_t n, char *o) {
  static const char *h = "0123456789abcdef";
  for(size_t i = 0; i < n; i++) { o[i*2] = h[b[i]>>4]; o[i*2+1] = h[b[i]&0xf]; }
  o[n*2] = 0;
}
static int fromHex(const char *s, uint8_t *o, size_t maxn) {
  size_t L = strlen(s);
  if(L & 1) return -1;
  size_t n = L / 2;
  if(n > maxn) return -1;
  auto ny = [](char c)->int {
    if(c>='0'&&c<='9') return c-'0';
    if(c>='a'&&c<='f') return c-'a'+10;
    if(c>='A'&&c<='F') return c-'A'+10;
    return -1;
  };
  for(size_t i = 0; i < n; i++) {
    int a = ny(s[i*2]), b = ny(s[i*2+1]);
    if(a<0||b<0) return -1;
    o[i] = (uint8_t)((a<<4)|b);
  }
  return (int)n;
}
static int jsonInt(const char *j, const char *k, int defVal) {
  char pat[20];
  snprintf(pat, sizeof(pat), "\"%s\":", k);
  const char *p = strstr(j, pat);
  if(!p) return defVal;
  p += strlen(pat);
  while(*p == ' ') p++;
  if(*p == '"') return atoi(p+1);
  return atoi(p);
}
static float jsonFloat(const char *j, const char *k, float defVal) {
  char pat[20];
  snprintf(pat, sizeof(pat), "\"%s\":", k);
  const char *p = strstr(j, pat);
  if(!p) return defVal;
  p += strlen(pat);
  while(*p == ' ') p++;
  if(*p == '"') p++;
  return (float)atof(p);
}
static void jsonStr(const char *j, const char *k, char *out, size_t n) {
  out[0] = 0;
  char pat[20];
  snprintf(pat, sizeof(pat), "\"%s\":", k);
  const char *p = strstr(j, pat);
  if(!p) return;
  p += strlen(pat);
  while(*p == ' ') p++;
  bool q = (*p == '"');
  if(q) p++;
  size_t i = 0;
  while(*p && i + 1 < n) {
    if(q) { if(*p == '"') break; }
    else if(*p == ',' || *p == '}' || *p == ' ') break;
    out[i++] = *p++;
  }
  out[i] = 0;
}

bool MeshController::begin() {
  memset(roomRadio, MESH_RADIO_AUTO, sizeof(roomRadio));
  roomRadio[0] = 0;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    ranks[i].shadeId = 255;
    for(uint8_t j = 0; j < MESH_MAX_PEERS+1; j++) ranks[i].rssi[j] = -127;
  }
  for(uint8_t i = 0; i < MESH_MAX_LISTEN; i++) {
    listen[i].addr = 0;
    listen[i].lastMs = 0;
    for(uint8_t j = 0; j < MESH_MAX_PEERS+1; j++) listen[i].rssi[j] = -127;
  }
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) peers[i].lastRssi = -127;
  load();
  loadFollow();
  if(role == MESH_UNSET) {
    for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
      if(somfy.shades[i].getShadeId() != 255) { role = MESH_ROUTER; save(); break; }
    }
  }
  return true;
}
bool MeshController::keepSetupHotspot() const {
  if(role == MESH_UNSET) return true;
  if(role != MESH_REPEATER) return false;
  if(!routerIp || !routerLastHb) return true;
  return (millis() - routerLastHb) >= MESH_OFFLINE_MS;
}
static void meshRoleToNvs(mesh_role_t role, mesh_txmode_t txMode) {
  Preferences p;
  if(!p.begin("mesh", false)) return;
  p.putUChar("role", (uint8_t)role);
  p.putUChar("txMode", (uint8_t)txMode);
  p.end();
}
static bool meshRoleFromNvs(mesh_role_t &role, mesh_txmode_t &txMode) {
  Preferences p;
  if(!p.begin("mesh", true)) return false;
  uint8_t r = p.getUChar("role", 0);
  uint8_t tm = p.getUChar("txMode", 0);
  p.end();
  if(r > 2 || tm > 1) return false;
  if(r == 0) return false;
  role = (mesh_role_t)r;
  txMode = (mesh_txmode_t)tm;
  return true;
}

bool MeshController::load() {
  File f = LittleFS.open("/mesh.cfg", "r");
  if(!f) return meshRoleFromNvs(role, txMode);
  uint8_t hdr[4];
  if(f.read(hdr, 4) != 4 || hdr[0] != 0x4D || hdr[2] > 2 || hdr[3] > 1) { f.close(); return false; }
  if(f.read((uint8_t*)routerId, sizeof(routerId)) != sizeof(routerId) || f.read((uint8_t*)&routerIp, 4) != 4) { f.close(); return false; }
  routerId[sizeof(routerId) - 1] = 0;
  uint8_t np = 0;
  f.read(&np, 1);
  if(np > MESH_MAX_PEERS) np = MESH_MAX_PEERS;
  memset(peers, 0, sizeof(peers));
  for(uint8_t i = 0; i < np; i++) {
    f.read((uint8_t*)peers[i].serverId, sizeof(peers[i].serverId));
    f.read((uint8_t*)peers[i].hostname, sizeof(peers[i].hostname));
    f.read((uint8_t*)&peers[i].ip, 4);
    peers[i].serverId[sizeof(peers[i].serverId) - 1] = 0;
    peers[i].hostname[sizeof(peers[i].hostname) - 1] = 0;
  }
  uint8_t nr = 0;
  f.read(&nr, 1);
  if(nr > SOMFY_MAX_SHADES) nr = SOMFY_MAX_SHADES;
  for(uint8_t i = 0; i < nr; i++) {
    f.read(&ranks[i].shadeId, 1);
    f.read((uint8_t*)ranks[i].rssi, sizeof(ranks[i].rssi));
  }
  memset(roomRadio, MESH_RADIO_AUTO, sizeof(roomRadio));
  roomRadio[0] = 0;
  if(f.available()) {
    uint8_t nra = 0;
    if(f.read(&nra, 1) == 1) {
      if(nra > SOMFY_MAX_ROOMS) nra = SOMFY_MAX_ROOMS;
      for(uint8_t i = 0; i < nra; i++) {
        uint8_t rid = 0, rad = 0;
        if(f.read(&rid, 1) != 1 || f.read(&rad, 1) != 1) break;
        if(rid && rid <= SOMFY_MAX_ROOMS && (rad <= MESH_MAX_PEERS || rad == MESH_RADIO_AUTO))
          roomRadio[rid] = rad;
      }
    }
  }
  f.close();
  role = (mesh_role_t)hdr[2];
  txMode = (mesh_txmode_t)hdr[3];
  meshRoleToNvs(role, txMode);
  return true;
}
bool MeshController::save() {
  meshRoleToNvs(role, txMode);
  File f = LittleFS.open("/mesh.tmp", "w");
  if(!f) return true;
  uint8_t magic = 0x4D, ver = 1, r = (uint8_t)role, tm = (uint8_t)txMode;
  f.write(&magic, 1); f.write(&ver, 1); f.write(&r, 1); f.write(&tm, 1);
  f.write((uint8_t*)routerId, sizeof(routerId));
  f.write((uint8_t*)&routerIp, 4);
  uint8_t np = 0;
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) if(peers[i].serverId[0]) np++;
  f.write(&np, 1);
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
    if(!peers[i].serverId[0]) continue;
    f.write((uint8_t*)peers[i].serverId, sizeof(peers[i].serverId));
    f.write((uint8_t*)peers[i].hostname, sizeof(peers[i].hostname));
    f.write((uint8_t*)&peers[i].ip, 4);
  }
  uint8_t nr = 0;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) if(ranks[i].shadeId != 255) nr++;
  f.write(&nr, 1);
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    if(ranks[i].shadeId == 255) continue;
    f.write(&ranks[i].shadeId, 1);
    f.write((uint8_t*)ranks[i].rssi, sizeof(ranks[i].rssi));
  }
  uint8_t nra = 0;
  for(uint8_t i = 0; i < SOMFY_MAX_ROOMS; i++) if(somfy.rooms[i].roomId) nra++;
  f.write(&nra, 1);
  for(uint8_t i = 0; i < SOMFY_MAX_ROOMS; i++) {
    uint8_t rid = somfy.rooms[i].roomId;
    if(!rid) continue;
    uint8_t rad = roomRadio[rid];
    f.write(&rid, 1);
    f.write(&rad, 1);
  }
  f.close();
  LittleFS.remove("/mesh.cfg");
  return LittleFS.rename("/mesh.tmp", "/mesh.cfg");
}
bool MeshController::appendToBackup(File &dst) {
  return backupAppendSection(dst, "MESH", "/mesh.cfg");
}
bool MeshController::restoreFromBackup() {
  if(!backupExtractSection("/shades.tmp", "MESH", "/mesh.cfg")
      && !backupExtractSection("/mesh.backup", "MESH", "/mesh.cfg"))
    return false;
  return this->load();
}
void MeshController::resetOriginal() {
  role = MESH_UNSET;
  txMode = MESH_BLAST;
  routerId[0] = 0;
  routerIp = 0;
  memset(peers, 0, sizeof(peers));
  memset(roomRadio, MESH_RADIO_AUTO, sizeof(roomRadio));
  roomRadio[0] = 0;
  assignedList[0] = 0;
  routerHost[0] = 0;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    ranks[i].shadeId = 255;
    somfy.shades[i].clear();
  }
  for(uint8_t i = 0; i < SOMFY_MAX_ROOMS; i++) somfy.rooms[i].clear();
  for(uint8_t i = 0; i < SOMFY_MAX_GROUPS; i++) somfy.groups[i].clear();
  save();
  somfy.commit();
}

void MeshController::deriveKey(uint8_t key[32]) {
  const char *p = (meshKey && meshKey[0]) ? meshKey
    : (settings.Security.password[0] ? settings.Security.password : settings.serverId);
  sha256((const uint8_t*)p, strlen(p), key);
}
bool MeshController::wrap(const char *plain, char *out, size_t outSz) {
  uint8_t key[32], nonce[8], mac[32];
  deriveKey(key);
  uint32_t r0 = esp_random(), r1 = esp_random();
  memcpy(nonce, &r0, 4); memcpy(nonce+4, &r1, 4);
  size_t n = strlen(plain);
  uint8_t buf[480];
  if(8 + n + 32 > sizeof(buf) || (8+n+32)*2+1 > outSz) return false;
  memcpy(buf, nonce, 8);
  uint8_t ks[32];
  uint8_t mix[40];
  memcpy(mix, key, 32); memcpy(mix+32, nonce, 8);
  sha256(mix, 40, ks);
  for(size_t i = 0; i < n; i++) buf[8+i] = ((const uint8_t*)plain)[i] ^ ks[i & 31];
  hmac256(key, buf, 8+n, mac);
  memcpy(buf+8+n, mac, 32);
  toHex(buf, 8+n+32, out);
  return true;
}
bool MeshController::unwrap(const char *in, char *plain, size_t plainSz) {
  uint8_t raw[480], key[32], mac[32], ks[32], mix[40];
  int n = fromHex(in, raw, sizeof(raw));
  if(n < 8+32) return false;
  size_t plen = (size_t)n - 40;
  if(plen + 1 > plainSz) return false;
  deriveKey(key);
  hmac256(key, raw, 8+plen, mac);
  if(memcmp(mac, raw+8+plen, 32) != 0) return false;
  memcpy(mix, key, 32); memcpy(mix+32, raw, 8);
  sha256(mix, 40, ks);
  for(size_t i = 0; i < plen; i++) plain[i] = raw[8+i] ^ ks[i & 31];
  plain[plen] = 0;
  return true;
}

bool MeshController::peerOnline(uint8_t i) const {
  if(i >= MESH_MAX_PEERS || !peers[i].serverId[0]) return false;
  return peers[i].lastHb && (millis() - peers[i].lastHb) < MESH_OFFLINE_MS;
}
int8_t MeshController::findPeer(const char *id) {
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++)
    if(peers[i].serverId[0] && strcmp(peers[i].serverId, id) == 0) return (int8_t)i;
  return -1;
}
int8_t MeshController::addPeer(const char *id, const char *host, uint32_t ip, const char *fw) {
  int8_t x = findPeer(id);
  if(x < 0) {
    for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
      if(!peers[i].serverId[0]) { x = (int8_t)i; break; }
    }
  }
  if(x < 0) return -1;
  strlcpy(peers[x].serverId, id, sizeof(peers[x].serverId));
  if(host && host[0] && !peers[x].hostname[0]) strlcpy(peers[x].hostname, host, sizeof(peers[x].hostname));
  if(fw) {
    strlcpy(peers[x].fw, fw, sizeof(peers[x].fw));
    if(otaFollow && otaTag[0] && !strcmp(peers[x].fw, otaTag))
      setPeerPhase((uint8_t)x, MESH_OTA_DONE);
  }
  if(ip) peers[x].ip = ip;
  peers[x].lastHb = millis();
  if(peers[x].onlineHits < 3) peers[x].onlineHits++;
  return x;
}
mesh_rank_t *MeshController::rankFor(uint8_t shadeId, bool create) {
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++)
    if(ranks[i].shadeId == shadeId) return &ranks[i];
  if(!create) return nullptr;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    if(ranks[i].shadeId == 255) {
      ranks[i].shadeId = shadeId;
      for(uint8_t j = 0; j < MESH_MAX_PEERS+1; j++) ranks[i].rssi[j] = -127;
      return &ranks[i];
    }
  }
  return nullptr;
}
void MeshController::noteRssi(uint8_t shadeId, const char *heardBy, int16_t rssi) {
  mesh_rank_t *r = rankFor(shadeId, true);
  if(!r) return;
  int8_t idx = radioIdx(heardBy);
  if(idx < 0) return;
  if(rssi > -127) r->rssi[idx] = rssi;
  if(idx > 0) peers[idx-1].lastRssi = rssi;
  ranksDirty = true;
}
int8_t MeshController::radioIdx(const char *heardBy) {
  if(!heardBy || !heardBy[0] || strcmp(heardBy, settings.serverId) == 0) return 0;
  int8_t p = findPeer(heardBy);
  if(p < 0) return -1;
  return (int8_t)(p + 1);
}
mesh_listen_t *MeshController::listenSlot(uint32_t addr, bool create) {
  int8_t hit = -1, empty = -1;
  uint32_t oldest = 0xFFFFFFFF;
  int8_t oldi = 0;
  for(uint8_t i = 0; i < MESH_MAX_LISTEN; i++) {
    if(listen[i].addr == addr) { hit = (int8_t)i; break; }
    if(!listen[i].addr && empty < 0) empty = (int8_t)i;
    if(listen[i].lastMs < oldest) { oldest = listen[i].lastMs; oldi = (int8_t)i; }
  }
  if(hit >= 0) return &listen[hit];
  if(!create) return nullptr;
  int8_t x = empty >= 0 ? empty : oldi;
  listen[x].addr = addr;
  listen[x].lastMs = millis();
  for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++) listen[x].rssi[j] = -127;
  return &listen[x];
}
void MeshController::noteListen(uint32_t addr, const char *heardBy, int16_t rssi) {
  if(!addr) return;
  int8_t idx = radioIdx(heardBy);
  if(idx < 0) return;
  mesh_listen_t *L = listenSlot(addr, true);
  if(!L) return;
  if(rssi > -127) L->rssi[idx] = rssi;
  L->lastMs = millis();
}
void MeshController::bindListen(uint32_t addr) {
  if(!addr || !isRouter()) return;
  mesh_listen_t *L = listenSlot(addr, false);
  if(!L) return;
  SomfyShade *s = somfy.findShadeByRemoteAddress(addr);
  if(!s) return;
  for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++) {
    if(L->rssi[j] <= -127) continue;
    if(j == 0) noteRssi(s->getShadeId(), settings.serverId, L->rssi[j]);
    else if(peers[j - 1].serverId[0]) noteRssi(s->getShadeId(), peers[j - 1].serverId, L->rssi[j]);
  }
}
void MeshController::noteRssiCluster(uint32_t addr, const char *heardBy, int16_t rssi) {
  noteListen(addr, heardBy, rssi);
  if(!addr) return;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    SomfyShade &sh = somfy.shades[i];
    if(sh.getShadeId() == 255) continue;
    bool hit = sh.getRemoteAddress() == addr;
    if(!hit) {
      for(uint8_t j = 0; j < SOMFY_MAX_LINKED_REMOTES; j++) {
        if(sh.linkedRemotes[j].getRemoteAddress() == addr) { hit = true; break; }
      }
    }
    if(hit) noteRssi(sh.getShadeId(), heardBy, rssi);
  }
}
int8_t MeshController::pickOwn(uint8_t shadeId) {
  mesh_rank_t *r = rankFor(shadeId, false);
  if(!r) return 0;
  int8_t best = 0;
  int16_t bestR = -128;
  auto consider = [&](int8_t idx, bool on) {
    if(!on) return;
    int16_t rssi = r->rssi[idx];
    if(rssi < MESH_MIN_RANK_RSSI) return;
    if(rssi > bestR) { bestR = rssi; best = idx; }
  };
  consider(0, true);
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++)
    consider((int8_t)(i + 1), peerOnline(i));
  if(bestR < MESH_MIN_RANK_RSSI) return 0;
  // Keep the loudest overall radio if it is still online and not beaten by much.
  int8_t want = 0;
  int16_t wantR = -128;
  for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++) {
    if(r->rssi[j] > wantR) { wantR = r->rssi[j]; want = (int8_t)j; }
  }
  bool wantOn = (want == 0) || (want > 0 && want <= MESH_MAX_PEERS && peerOnline((uint8_t)(want - 1)));
  if(wantOn && wantR >= MESH_MIN_RANK_RSSI && bestR < wantR + MESH_HYSTERESIS_DB)
    return want;
  return best;
}
int8_t MeshController::pickWant(uint8_t shadeId) {
  mesh_rank_t *r = rankFor(shadeId, false);
  if(!r) return 0;
  int8_t best = 0;
  int16_t bestR = -128;
  for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++) {
    if(r->rssi[j] > bestR) { bestR = r->rssi[j]; best = (int8_t)j; }
  }
  return bestR >= MESH_MIN_RANK_RSSI ? best : 0;
}
bool MeshController::hasOwnRank(uint8_t shadeId) {
  mesh_rank_t *r = rankFor(shadeId, false);
  if(!r) return false;
  for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++)
    if(r->rssi[j] >= MESH_MIN_RANK_RSSI) return true;
  return false;
}
bool MeshController::heardAny(uint8_t shadeId) {
  mesh_rank_t *r = rankFor(shadeId, false);
  if(!r) return false;
  for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++)
    if(r->rssi[j] > -127) return true;
  return false;
}
int8_t MeshController::pickRadioForRoom(uint8_t roomId) {
  if(!roomId || roomId > SOMFY_MAX_ROOMS) return 0;
  uint8_t mode = roomRadio[roomId];
  auto bestInRoom = [&]() -> int8_t {
    int8_t best = 0;
    int16_t bestR = -128;
    for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
      SomfyShade &sh = somfy.shades[i];
      if(sh.getShadeId() == 255 || sh.roomId != roomId || !hasOwnRank(sh.getShadeId())) continue;
      int8_t p = pickOwn(sh.getShadeId());
      mesh_rank_t *r = rankFor(sh.getShadeId(), false);
      int16_t rssi = r ? r->rssi[p] : -127;
      if(rssi >= MESH_MIN_RANK_RSSI && rssi > bestR) { bestR = rssi; best = p; }
    }
    return best;
  };
  if(mode == MESH_RADIO_AUTO) return bestInRoom();
  if(mode == 0) return 0;
  if(mode <= MESH_MAX_PEERS && peers[mode - 1].serverId[0] && peerOnline(mode - 1))
    return (int8_t)mode;
  // Assigned slave offline → next-best online radio, else Router.
  return bestInRoom();
}
int8_t MeshController::pickRadio(uint8_t shadeId) {
  SomfyShade *s = somfy.getShadeById(shadeId);
  uint8_t room = s ? s->roomId : 0;
  uint8_t mode = (room && room <= SOMFY_MAX_ROOMS) ? roomRadio[room] : MESH_RADIO_AUTO;
  if(mode == MESH_RADIO_AUTO) {
    if(hasOwnRank(shadeId)) return pickOwn(shadeId);
    if(room) return pickRadioForRoom(room);
    return 0;
  }
  if(room) return pickRadioForRoom(room);
  if(hasOwnRank(shadeId)) return pickOwn(shadeId);
  return 0;
}
int8_t MeshController::radioForTx(uint32_t address) {
  SomfyShade *s = somfy.findShadeByRemoteAddress(address);
  if(s) return pickRadio(s->getShadeId());
  SomfyGroup *g = somfy.findGroupByRemoteAddress(address);
  if(g) return pickRadioForRoom(g->roomId);
  return 0;
}
bool MeshController::shouldLocalTx(uint32_t address) {
  if(isRepeater()) return false;
  if(!isRouter()) return true;
  int8_t p = radioForTx(address);
  if(p > 0 && peerOnline((uint8_t)(p - 1))) return false;
  return true;
}
void MeshController::queueOut(uint32_t ip, const char *json) {
  if(!ip) return;
  if(outN >= MESH_MAX_OUT) {
    int8_t drop = 0;
    for(uint8_t i = 0; i < outN; i++) {
      if(!strstr(outJson[i], "\"t\":\"tx\"")) { drop = (int8_t)i; break; }
    }
    for(uint8_t i = drop + 1; i < outN; i++) {
      outIp[i - 1] = outIp[i];
      strlcpy(outJson[i - 1], outJson[i], sizeof(outJson[0]));
    }
    outN--;
  }
  outIp[outN] = ip;
  strlcpy(outJson[outN], json, sizeof(outJson[0]));
  outN++;
}
void MeshController::flushOut() {
  if(!outN || !net.connected()) return;
  uint32_t ip = outIp[0];
  if(isRepeater() && routerIp) ip = routerIp;
  char payload[440];
  strlcpy(payload, outJson[0], sizeof(payload));
  char wrapped[960];
  if(!wrap(payload, wrapped, sizeof(wrapped))) {
    for(uint8_t i = 1; i < outN; i++) { outIp[i-1] = outIp[i]; strlcpy(outJson[i-1], outJson[i], sizeof(outJson[0])); }
    outN--;
    return;
  }
  for(uint8_t i = 1; i < outN; i++) { outIp[i-1] = outIp[i]; strlcpy(outJson[i-1], outJson[i], sizeof(outJson[0])); }
  outN--;
  IPAddress a(ip);
  char url[40];
  snprintf(url, sizeof(url), "http://%u.%u.%u.%u/mesh", a[0], a[1], a[2], a[3]);
  int code = -1;
  for(uint8_t attempt = 0; attempt < 2 && code != 200; attempt++) {
    HTTPClient http;
    WiFiClient cli;
    http.setTimeout(700);
    if(!http.begin(cli, url)) continue;
    http.addHeader("Content-Type", "text/plain");
    code = http.POST((uint8_t*)wrapped, strlen(wrapped));
    if(code == 200 && isRepeater()) {
      routerLastHb = millis();
      String body = http.getString();
      char plain[280];
      if(unwrap(body.c_str(), plain, sizeof(plain))) {
        jsonStr(plain, "sh", assignedList, sizeof(assignedList));
        jsonStr(plain, "host", routerHost, sizeof(routerHost));
      }
    }
    http.end();
    esp_task_wdt_reset();
  }
}
void MeshController::relayTx(somfy_frame_t &frame, uint8_t repeat) {
  if(!isRouter()) return;
  int8_t p = radioForTx(frame.remoteAddress);
  if(p <= 0 || !peerOnline((uint8_t)(p - 1))) return;
  char js[320];
  snprintf(js, sizeof(js),
    "{\"t\":\"tx\",\"cmd\":%u,\"addr\":%u,\"rcode\":%u,\"enc\":%u,\"bits\":%u,\"rep\":%u,\"proto\":%u,\"st\":1}",
    (unsigned)frame.cmd, (unsigned)frame.remoteAddress, (unsigned)frame.rollingCode,
    (unsigned)frame.encKey, (unsigned)frame.bitLength, (unsigned)repeat, (unsigned)frame.proto);
  queueOut(peers[p - 1].ip, js);
}
static void localMacStr(char *out, size_t n) {
  String m = WiFi.macAddress();
  strlcpy(out, m.c_str(), n);
}
bool MeshController::onLocalRx(somfy_frame_t &frame) {
  if(!frame.valid) return false;
  uint32_t now = millis();
  bool dup = frame.remoteAddress == lastRxAddr && frame.rollingCode == lastRxCode && (now - lastRxMs) < 2000;
  if(isRouter()) noteRssiCluster(frame.remoteAddress, settings.serverId, frame.rssi);
  if(dup) return true;
  lastRxAddr = frame.remoteAddress; lastRxCode = frame.rollingCode; lastRxMs = now;
  if(isRepeater() && routerIp) {
    char js[280];
    snprintf(js, sizeof(js),
      "{\"t\":\"rx\",\"id\":\"%s\",\"addr\":%u,\"rcode\":%u,\"cmd\":%u,\"bits\":%u,\"rssi\":%d,\"enc\":%u,\"proto\":%u}",
      settings.serverId, (unsigned)frame.remoteAddress, (unsigned)frame.rollingCode,
      (unsigned)frame.cmd, (unsigned)frame.bitLength, (int)frame.rssi, (unsigned)frame.encKey,
      (unsigned)frame.proto);
    queueOut(routerIp, js);
  }
  return false;
}
void MeshController::sendBeacon() {
  if(!net.connected() || role == MESH_UNSET) return;
  IPAddress ip = WiFi.localIP();
  IPAddress mask = WiFi.subnetMask();
  if(net.connType == conn_types_t::ethernet) { ip = ETH.localIP(); mask = ETH.subnetMask(); }
  IPAddress bcast = IPAddress((uint32_t)ip | ~(uint32_t)mask);
  char pkt[112];
  snprintf(pkt, sizeof(pkt), "ESPM1,%u,%s,%s,%s,%u", (unsigned)role, settings.serverId, settings.hostname, settings.fwVersion.name, (unsigned)settings.Security.type);
  meshUdp.beginPacket(bcast, MESH_UDP_PORT);
  meshUdp.write((uint8_t*)pkt, strlen(pkt));
  meshUdp.endPacket();
}
void MeshController::noteHeard(uint8_t rle, const char *id, const char *host, const char *fw, uint32_t ip, uint8_t auth) {
  int8_t x = -1;
  for(uint8_t i = 0; i < MESH_MAX_HEARD; i++) if(heard[i].id[0] && strcmp(heard[i].id, id) == 0) { x = (int8_t)i; break; }
  if(x < 0) {
    for(uint8_t i = 0; i < MESH_MAX_HEARD; i++) if(!heard[i].id[0]) { x = (int8_t)i; break; }
    if(x < 0) {
      uint32_t oldest = UINT32_MAX;
      for(uint8_t i = 0; i < MESH_MAX_HEARD; i++) if(heard[i].last < oldest) { oldest = heard[i].last; x = (int8_t)i; }
    }
  }
  if(x < 0) return;
  strlcpy(heard[x].id, id, sizeof(heard[x].id));
  if(host) strlcpy(heard[x].host, host, sizeof(heard[x].host));
  if(fw) strlcpy(heard[x].fw, fw, sizeof(heard[x].fw));
  heard[x].ip = ip;
  heard[x].last = millis();
  heard[x].role = rle;
  heard[x].auth = auth;
}
void MeshController::pollUdp() {
  int n = meshUdp.parsePacket();
  if(n <= 0) return;
  char buf[128];
  int r = meshUdp.read(buf, sizeof(buf)-1);
  if(r <= 0) return;
  buf[r] = 0;
  if(strncmp(buf, "ESPM1,", 6) != 0) return;
  uint8_t rle = 0, auth = 0; char id[10]="", host[32]="", fw[16]="";
  sscanf(buf+6, "%hhu,%9[^,],%31[^,],%15[^,],%hhu", &rle, id, host, fw, &auth);
  if(!id[0] || strcmp(id, settings.serverId) == 0) return;
  uint32_t ip = (uint32_t)meshUdp.remoteIP();
  noteHeard(rle, id, host, fw, ip, auth);
  if(isRouter() && rle == MESH_REPEATER) {
    int8_t x = findPeer(id);
    if(x >= 0) {
      if(ip) peers[x].ip = ip;
      if(host[0] && peers[x].hostname[0] && strcmp(peers[x].hostname, host) != 0)
        queuePeerName((uint8_t)x);
    }
  }
  if(isRepeater() && rle == MESH_ROUTER) {
    if(routerId[0] && !strcmp(routerId, id)) {
      if(ip != routerIp) { routerIp = ip; save(); }
    } else if(!routerId[0] && ip == routerIp) {
      strlcpy(routerId, id, sizeof(routerId));
      save();
    } else if(!routerId[0] && (!routerLastHb || (millis() - routerLastHb) >= MESH_OFFLINE_MS))
      routerIp = ip;
  }
}
void MeshController::sendHeartbeat() {
  if(!isRepeater() || !routerIp) return;
  char mac[18], js[280];
  localMacStr(mac, sizeof(mac));
  snprintf(js, sizeof(js),
    "{\"t\":\"hb\",\"id\":\"%s\",\"host\":\"%s\",\"fw\":\"%s\",\"up\":%u,\"heap\":%u,\"mac\":\"%s\"}",
    settings.serverId, settings.hostname, settings.fwVersion.name,
    (unsigned)(millis()/1000), (unsigned)ESP.getFreeHeap(), mac);
  queueOut(routerIp, js);
}
void MeshController::loop() {
  if(!net.connected()) {
    if(meshUdpOn) { meshUdp.stop(); meshUdpOn = false; }
    return;
  }
  if(!meshUdpOn) { meshUdp.begin(MESH_UDP_PORT); meshUdpOn = true; }
  pollUdp();
  uint32_t now = millis();
  if(now - lastBeacon > 2000) { lastBeacon = now; sendBeacon(); }
  if(isRepeater() && now - lastHbOut > MESH_HB_MS) { lastHbOut = now; sendHeartbeat(); }
  flushOut();
  if(ranksDirty && (now - lastRankSave) > 2000) { ranksDirty = false; lastRankSave = now; save(); }
  loopFollow();
  if(!outN) meshKey = nullptr;
}
void MeshController::applyInner(const char *plain, uint32_t fromIp, char *reply, size_t replySz) {
  char t[8] = "", id[10] = "", host[32] = "", fw[16] = "";
  jsonStr(plain, "t", t, sizeof(t));
  jsonStr(plain, "id", id, sizeof(id));
  jsonStr(plain, "host", host, sizeof(host));
  jsonStr(plain, "fw", fw, sizeof(fw));
  reply[0] = 0;
  if(!strcmp(t, "pair") && isRouter()) {
    int8_t x = addPeer(id, host, fromIp, fw);
    if(x < 0) { snprintf(reply, replySz, "{\"t\":\"err\",\"e\":\"full\"}"); return; }
    char mac[18] = "";
    jsonStr(plain, "mac", mac, sizeof(mac));
    if(mac[0]) strlcpy(peers[x].mac, mac, sizeof(peers[x].mac));
    save();
    if(x >= 0) {
      queueSync(peers[x].ip);
      peers[x].lastCfgMs = millis();
    }
    snprintf(reply, replySz, "{\"t\":\"ok\",\"id\":\"%s\"}", settings.serverId);
  }
  else if(!strcmp(t, "hb") && isRouter()) {
    int8_t existing = findPeer(id);
    bool needCfg = true;
    if(existing >= 0 && peerOnline((uint8_t)existing) && peers[existing].lastCfgMs
      && (millis() - peers[existing].lastCfgMs) <= 60000) needCfg = false;
    int8_t x = addPeer(id, host, fromIp, fw);
    if(x >= 0) {
      peers[x].uptime = (uint32_t)jsonInt(plain, "up", 0);
      peers[x].heap = (uint32_t)jsonInt(plain, "heap", 0);
      char mac[18] = "";
      jsonStr(plain, "mac", mac, sizeof(mac));
      if(mac[0]) strlcpy(peers[x].mac, mac, sizeof(peers[x].mac));
      if(host[0] && peers[x].hostname[0] && strcmp(peers[x].hostname, host) != 0)
        queuePeerName((uint8_t)x);
      if(needCfg) {
        queueSync(peers[x].ip);
        peers[x].lastCfgMs = millis();
      }
    }
    char list[160] = "";
    int8_t pidx = findPeer(id);
    for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
      SomfyShade &sh = somfy.shades[i];
      if(sh.getShadeId() == 255) continue;
      int8_t p = pickRadio(sh.getShadeId()) - 1;
      if(pidx >= 0 && p == pidx) {
        char one[24];
        snprintf(one, sizeof(one), "%s%u", list[0]?",":"", (unsigned)sh.getShadeId());
        strlcat(list, one, sizeof(list));
      }
    }
    snprintf(reply, replySz, "{\"t\":\"ok\",\"host\":\"%s\",\"sh\":\"%s\"}", settings.hostname, list);
  }
  else if(!strcmp(t, "tx") && isRepeater()) {
    somfy_frame_t fr;
    memset(&fr, 0, sizeof(fr));
    fr.cmd = (somfy_commands)jsonInt(plain, "cmd", 0);
    fr.remoteAddress = (uint32_t)jsonInt(plain, "addr", 0);
    fr.rollingCode = (uint16_t)jsonInt(plain, "rcode", 0);
    fr.encKey = (uint8_t)jsonInt(plain, "enc", 0xA0);
    fr.bitLength = (uint8_t)jsonInt(plain, "bits", 56);
    fr.proto = (radio_proto)jsonInt(plain, "proto", 0);
    fr.valid = true;
    uint8_t delayIdx = (uint8_t)jsonInt(plain, "st", 1);
    if(delayIdx) delay(40 * delayIdx);
    esp_task_wdt_reset();
    somfy.sendFrame(fr, (uint8_t)jsonInt(plain, "rep", 0), true);
    snprintf(reply, replySz, "{\"t\":\"ok\"}");
  }
  else if(!strcmp(t, "rx") && isRouter()) {
    uint32_t addr = (uint32_t)jsonInt(plain, "addr", 0);
    uint16_t rc = (uint16_t)jsonInt(plain, "rcode", 0);
    uint32_t now = millis();
    int16_t rssi = (int16_t)jsonInt(plain, "rssi", -127);
    int8_t x = findPeer(id);
    if(x >= 0) {
      peers[x].lastRssi = rssi;
      peers[x].lastAddr = addr;
    }
    noteRssiCluster(addr, id, rssi);
    somfy_frame_t fr;
    memset(&fr, 0, sizeof(fr));
    fr.remoteAddress = addr;
    fr.rollingCode = rc;
    fr.cmd = (somfy_commands)jsonInt(plain, "cmd", 0);
    fr.bitLength = (uint8_t)jsonInt(plain, "bits", 56);
    fr.rssi = rssi;
    fr.encKey = (uint8_t)jsonInt(plain, "enc", 0);
    fr.proto = (radio_proto)jsonInt(plain, "proto", 0);
    fr.valid = addr != 0;
    char src[48] = "";
    if(x >= 0) {
      const char *name = peers[x].hostname[0] ? peers[x].hostname : peers[x].serverId;
      snprintf(src, sizeof(src), "Slave %u · %s", (unsigned)(x + 1), name);
    }
    somfy.transceiver.emitFrame(&fr, nullptr, src[0] ? src : nullptr);
    if(fr.valid && !(addr == lastRxAddr && rc == lastRxCode && (now - lastRxMs) < 2000)) {
      lastRxAddr = addr; lastRxCode = rc; lastRxMs = now;
      somfy.processFrame(fr, false);
    }
    snprintf(reply, replySz, "{\"t\":\"ok\"}");
  }
  else if(!strcmp(t, "sync") && isRepeater()) {
    char user[33] = "", pass[65] = "", tz[64] = "", ntp[65] = "";
    jsonStr(plain, "user", user, sizeof(user));
    jsonStr(plain, "pass", pass, sizeof(pass));
    jsonStr(plain, "tz", tz, sizeof(tz));
    jsonStr(plain, "ntp", ntp, sizeof(ntp));
    if(user[0]) strlcpy(settings.Security.username, user, sizeof(settings.Security.username));
    if(pass[0]) strlcpy(settings.Security.password, pass, sizeof(settings.Security.password));
    if(strstr(plain, "\"st\":")) settings.Security.type = (security_types)jsonInt(plain, "st", 0);
    settings.Security.save();
    bool ntpCh = false;
    if(tz[0] && strcmp(settings.NTP.posixZone, tz) != 0) {
      strlcpy(settings.NTP.posixZone, tz, sizeof(settings.NTP.posixZone));
      ntpCh = true;
    }
    if(ntp[0] && strcmp(settings.NTP.ntpServer, ntp) != 0) {
      strlcpy(settings.NTP.ntpServer, ntp, sizeof(settings.NTP.ntpServer));
      ntpCh = true;
    }
    if(ntpCh) {
      settings.NTP.save();
      setenv("TZ", settings.NTP.posixZone, 1);
    }
    if(strstr(plain, "\"fq\":")) {
      transceiver_config_t &c = somfy.transceiver.config;
      bool en = jsonInt(plain, "en", c.enabled ? 1 : 0) != 0;
      uint8_t typ = (uint8_t)jsonInt(plain, "typ", c.type);
      uint8_t pr = (uint8_t)jsonInt(plain, "pr", (int)c.proto);
      float fq = jsonFloat(plain, "fq", c.frequency);
      float bw = jsonFloat(plain, "bw", c.rxBandwidth);
      float dv = jsonFloat(plain, "dv", c.deviation);
      int8_t pw = (int8_t)jsonInt(plain, "pw", c.txPower);
      float dfq = fq - c.frequency, dbw = bw - c.rxBandwidth, ddv = dv - c.deviation;
      bool radioCh = en != c.enabled || typ != c.type || pr != (uint8_t)c.proto
        || pw != c.txPower
        || dfq > 0.001f || dfq < -0.001f
        || dbw > 0.01f || dbw < -0.01f
        || ddv > 0.01f || ddv < -0.01f;
      if(radioCh) {
        c.enabled = en;
        c.type = typ;
        c.proto = (radio_proto)pr;
        c.frequency = fq;
        c.rxBandwidth = bw;
        c.deviation = dv;
        c.txPower = pw;
        somfy.transceiver.save();
      }
    }
    snprintf(reply, replySz, "{\"t\":\"ok\"}");
  }
  else if(!strcmp(t, "name") && isRepeater()) {
    if(host[0]) {
      strlcpy(settings.hostname, host, sizeof(settings.hostname));
      settings.save();
      net.updateHostname();
    }
    snprintf(reply, replySz, "{\"t\":\"ok\"}");
  }
}
void MeshController::handleHttp(WebServer &server) {
  if(server.method() == HTTP_OPTIONS) { server.send(200, "OK"); return; }
  if(server.method() != HTTP_POST) { server.send(405); return; }
  char plain[440];
  String body = server.arg("plain");
  if(!unwrap(body.c_str(), plain, sizeof(plain))) {
    server.send(403, "text/plain", "x");
    return;
  }
  char reply[280] = "";
  applyInner(plain, (uint32_t)server.client().remoteIP(), reply, sizeof(reply));
  if(!reply[0]) strcpy(reply, "{\"t\":\"ok\"}");
  char wrapped[960];
  if(!wrap(reply, wrapped, sizeof(wrapped))) { server.send(200, "text/plain", "ok"); return; }
  server.send(200, "text/plain", wrapped);
}
void MeshController::queueSync(uint32_t ip) {
  if(!ip) return;
  transceiver_config_t &c = somfy.transceiver.config;
  char js[440];
  snprintf(js, sizeof(js),
    "{\"t\":\"sync\",\"user\":\"%s\",\"pass\":\"%s\",\"st\":%u,\"tz\":\"%s\",\"ntp\":\"%s\","
    "\"en\":%u,\"typ\":%u,\"pr\":%u,\"fq\":%.3f,\"bw\":%.2f,\"dv\":%.2f,\"pw\":%d}",
    settings.Security.username, settings.Security.password, (unsigned)settings.Security.type,
    settings.NTP.posixZone, settings.NTP.ntpServer,
    c.enabled ? 1u : 0u, (unsigned)c.type, (unsigned)c.proto,
    (double)c.frequency, (double)c.rxBandwidth, (double)c.deviation, (int)c.txPower);
  queueOut(ip, js);
}
void MeshController::queuePeerName(uint8_t idx) {
  if(idx >= MESH_MAX_PEERS || !peers[idx].serverId[0] || !peers[idx].ip || !peers[idx].hostname[0]) return;
  char js[80];
  snprintf(js, sizeof(js), "{\"t\":\"name\",\"host\":\"%s\"}", peers[idx].hostname);
  queueOut(peers[idx].ip, js);
}
void MeshController::syncSettingsToPeers(const char *oldPass) {
  if(!isRouter()) return;
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
    if(peers[i].serverId[0] && peers[i].ip) {
      queueSync(peers[i].ip);
      peers[i].lastCfgMs = millis();
    }
  }
  meshKey = (oldPass && oldPass[0]) ? oldPass : nullptr;
}
void MeshController::toJSON(JsonResponse &json) {
  json.addElem("role", (uint8_t)role);
  json.addElem("txMode", (uint8_t)txMode);
  json.addElem("serverId", settings.serverId);
  json.addElem("routerId", routerId);
  json.addElem("routerHost", routerHost);
  json.addElem("routerIp", routerIp);
  json.addElem("routerOnline", isRepeater() && routerLastHb && (millis()-routerLastHb) < MESH_OFFLINE_MS);
  json.addElem("routerHb", (uint32_t)routerLastHb);
  json.addElem("assigned", assignedList);
  json.addElem("minRssi", (int32_t)MESH_MIN_RANK_RSSI);
  json.beginArray("peers");
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
    if(!peers[i].serverId[0]) continue;
    json.beginObject();
    json.addElem("id", peers[i].serverId);
    json.addElem("hostname", peers[i].hostname);
    json.addElem("fw", peers[i].fw);
    json.addElem("ip", peers[i].ip);
    json.addElem("online", peerOnline(i));
    json.addElem("hb", peers[i].lastHb);
    json.addElem("uptime", peers[i].uptime);
    json.addElem("heap", peers[i].heap);
    json.addElem("rssi", (int32_t)peers[i].lastRssi);
    json.addElem("lastAddr", peers[i].lastAddr);
    json.addElem("slot", (uint8_t)(i + 1));
    json.addElem("mac", peers[i].mac);
    json.addElem("phase", phaseName(peers[i].otaPhase));
    json.addElem("otaError", peers[i].otaErr);
    json.addElem("updating", peers[i].otaPhase == MESH_OTA_FLASHING || peers[i].otaPhase == MESH_OTA_REBOOTING || peers[i].otaPhase == MESH_OTA_QUEUED);
    json.beginArray("shades");
    for(uint8_t s = 0; s < SOMFY_MAX_SHADES; s++) {
      if(somfy.shades[s].getShadeId() == 255) continue;
      if(pickRadio(somfy.shades[s].getShadeId()) == (int8_t)(i+1))
        json.addElem(somfy.shades[s].getShadeId());
    }
    json.endArray();
    json.endObject();
  }
  json.endArray();
  json.beginArray("heard");
  for(uint8_t i = 0; i < MESH_MAX_HEARD; i++) {
    if(!heard[i].id[0]) continue;
    json.beginObject();
    json.addElem("id", heard[i].id);
    json.addElem("hostname", heard[i].host);
    json.addElem("fw", heard[i].fw);
    json.addElem("ip", heard[i].ip);
    json.addElem("role", heard[i].role);
    json.addElem("auth", heard[i].auth);
    json.endObject();
  }
  json.endArray();
  json.beginArray("ranks");
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    if(ranks[i].shadeId == 255) continue;
    json.beginObject();
    json.addElem("shadeId", ranks[i].shadeId);
    json.addElem("pick", pickRadio(ranks[i].shadeId));
    json.addElem("want", pickWant(ranks[i].shadeId));
    json.beginArray("rssi");
    for(uint8_t j = 0; j < MESH_MAX_PEERS+1; j++) json.addElem((int32_t)ranks[i].rssi[j]);
    json.endArray();
    json.beginArray("also");
    SomfyShade *src = somfy.getShadeById(ranks[i].shadeId);
    uint8_t room = src ? src->roomId : 0;
    if(room && pickOwn(ranks[i].shadeId) == pickRadioForRoom(room)) {
      for(uint8_t s = 0; s < SOMFY_MAX_SHADES; s++) {
        SomfyShade &sh = somfy.shades[s];
        if(sh.getShadeId() == 255 || sh.roomId != room || sh.getShadeId() == ranks[i].shadeId) continue;
        if(!hasOwnRank(sh.getShadeId()) && !heardAny(sh.getShadeId())) json.addElem(sh.getShadeId());
      }
    }
    json.endArray();
    json.endObject();
  }
  json.endArray();
  json.beginArray("rooms");
  for(uint8_t i = 0; i < SOMFY_MAX_ROOMS; i++) {
    uint8_t id = somfy.rooms[i].roomId;
    if(!id) continue;
    json.beginObject();
    json.addElem("roomId", id);
    json.addElem("name", somfy.rooms[i].name);
    json.addElem("radio", roomRadio[id]);
    json.addElem("pick", pickRadioForRoom(id));
    json.endObject();
  }
  json.endArray();
  json.addElem("otaFollow", otaFollow);
  json.addElem("otaTag", otaTag);
}

static int meshFwMajor(const char *s) {
  if(!s || !s[0]) return 0;
  appver_t v;
  v.parse(s);
  return v.major;
}
static bool jsonTrue(const char *j, const char *k) {
  char pat[24];
  snprintf(pat, sizeof(pat), "\"%s\":", k);
  const char *p = strstr(j, pat);
  if(!p) return false;
  p += strlen(pat);
  while(*p == ' ') p++;
  if(*p == '"') p++;
  return *p == 't' || *p == 'T' || *p == '1';
}
static const char *MESH_OTA_BOUNDARY = "espsomfyfleet";
struct mesh_ota_up_t {
  WiFiClient *cli;
  bool open;
  bool ok;
  uint8_t idx;
  char err[48];
};
static mesh_ota_up_t otaUp;
static char meshJsonBuf[4096];
static void otaCliStop() {
  if(!otaUp.cli) return;
  otaUp.cli->stop();
  delete otaUp.cli;
  otaUp.cli = nullptr;
}

const char *MeshController::phaseName(uint8_t phase) const {
  switch(phase) {
    case MESH_OTA_QUEUED: return "queued";
    case MESH_OTA_FLASHING: return "flashing";
    case MESH_OTA_REBOOTING: return "rebooting";
    case MESH_OTA_DONE: return "done";
    case MESH_OTA_FAILED: return "failed";
    default: return "idle";
  }
}
void MeshController::setPeerPhase(uint8_t idx, uint8_t phase, const char *err) {
  if(idx >= MESH_MAX_PEERS) return;
  peers[idx].otaPhase = phase;
  if(err) strlcpy(peers[idx].otaErr, err, sizeof(peers[idx].otaErr));
  else if(phase != MESH_OTA_FAILED) peers[idx].otaErr[0] = 0;
  if(phase == MESH_OTA_FLASHING) peers[idx].otaUntil = millis() + 180000;
  else if(phase == MESH_OTA_REBOOTING) peers[idx].otaUntil = millis() + 90000;
}
void MeshController::loadFollow() {
  Preferences p;
  if(!p.begin("mesh", true)) return;
  otaFollow = p.getBool("otaFollow", false);
  p.getString("otaTag", otaTag, sizeof(otaTag));
  p.end();
}
bool MeshController::setFollowTag(const char *tag, bool on) {
  if(tag && tag[0]) strlcpy(otaTag, tag, sizeof(otaTag));
  otaFollow = on && otaTag[0];
  Preferences p;
  if(!p.begin("mesh", false)) return false;
  p.putBool("otaFollow", otaFollow);
  p.putString("otaTag", otaTag);
  p.end();
  return true;
}
void MeshController::clearFollow() {
  otaFollow = false;
  Preferences p;
  if(!p.begin("mesh", false)) return;
  p.putBool("otaFollow", false);
  p.end();
}
bool MeshController::otaPartitionOk(const char *peerFw, const char *tag) {
  int pm = meshFwMajor(peerFw);
  int tm = meshFwMajor(tag);
  if(tm <= 0) return true;
  if(pm > 0 && pm < 3 && tm >= 3) return false;
  if(pm >= 3 && tm > 0 && tm < 3) return false;
  return true;
}
static int meshHttp(uint32_t ip, const char *method, const char *path, const char *apiKey, const char *body, char *out, size_t outSz, uint32_t timeoutMs) {
  WiFiClient cli;
  IPAddress a(ip);
  if(!cli.connect(a, 80)) return -1;
  cli.setTimeout(200);
  cli.printf("%s %s HTTP/1.1\r\nHost: %u.%u.%u.%u\r\nConnection: close\r\n", method, path, a[0], a[1], a[2], a[3]);
  if(apiKey && apiKey[0]) cli.printf("apikey: %s\r\n", apiKey);
  if(body) {
    cli.printf("Content-Type: application/json\r\nContent-Length: %u\r\n\r\n", (unsigned)strlen(body));
    cli.print(body);
  } else cli.print("\r\n");
  uint32_t start = millis();
  int code = 0;
  String line;
  bool headers = true;
  if(out && outSz) out[0] = 0;
  while((cli.connected() || cli.available()) && millis() - start < timeoutMs) {
    esp_task_wdt_reset();
    if(!cli.available()) { delay(10); continue; }
    if(headers) {
      line = cli.readStringUntil('\n');
      if(line.startsWith("HTTP/")) code = line.substring(9).toInt();
      if(line == "\r" || line == "") headers = false;
    } else if(out && outSz) {
      size_t have = strlen(out);
      if(have + 1 >= outSz) break;
      int n = cli.readBytes(out + have, outSz - 1 - have);
      if(n <= 0) break;
      out[have + (size_t)n] = 0;
    } else cli.read();
  }
  cli.stop();
  return code;
}
bool MeshController::peerLogin(uint32_t ip, char *apiKey, size_t keySz) {
  if(apiKey && keySz) apiKey[0] = 0;
  if(!ip) return false;
  char body[192], resp[384];
  snprintf(body, sizeof(body), "{\"username\":\"%s\",\"password\":\"%s\",\"pin\":\"%s\"}",
    settings.Security.username, settings.Security.password, settings.Security.pin);
  int code = meshHttp(ip, "POST", "/login", nullptr, body, resp, sizeof(resp), 8000);
  if(code != 200) return settings.Security.type == security_types::None;
  if(apiKey && keySz) jsonStr(resp, "apiKey", apiKey, keySz);
  if(settings.Security.type != security_types::None && !jsonTrue(resp, "success")) return false;
  return true;
}
bool MeshController::peerGitOta(uint8_t idx, const char *tag) {
  if(idx >= MESH_MAX_PEERS || !peers[idx].ip || !tag || !tag[0]) return false;
  if(peers[idx].fw[0] && !strcmp(peers[idx].fw, tag)) {
    setPeerPhase(idx, MESH_OTA_DONE);
    return true;
  }
  if(!otaPartitionOk(peers[idx].fw, tag)) {
    setPeerPhase(idx, MESH_OTA_FAILED, "partition");
    return false;
  }
  if(!peerOnline(idx)) {
    setPeerPhase(idx, MESH_OTA_FAILED, "offline");
    return false;
  }
  char key[65];
  setPeerPhase(idx, MESH_OTA_FLASHING);
  peers[idx].otaTries++;
  if(!peerLogin(peers[idx].ip, key, sizeof(key))) {
    setPeerPhase(idx, MESH_OTA_FAILED, "login");
    return false;
  }
  char path[80];
  snprintf(path, sizeof(path), "/downloadFirmware?ver=%s", tag);
  int code = meshHttp(peers[idx].ip, "PUT", path, key, "{}", nullptr, 0, 25000);
  if(code != 200) {
    setPeerPhase(idx, MESH_OTA_FAILED, "github");
    return false;
  }
  setPeerPhase(idx, MESH_OTA_REBOOTING);
  return true;
}
bool MeshController::triggerGitOta(const char *peerId, const char *tag) {
  if(!isRouter()) return false;
  const char *use = (tag && tag[0] && strcmp(tag, "current")) ? tag : settings.fwVersion.name;
  if(!use || !use[0]) return false;
  bool one = peerId && peerId[0] && strcmp(peerId, "all") != 0;
  if(!one) setFollowTag(use, true);
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
    if(!peers[i].serverId[0]) continue;
    if(one && strcmp(peers[i].serverId, peerId) != 0) continue;
    if(peers[i].fw[0] && !strcmp(peers[i].fw, use)) {
      setPeerPhase(i, MESH_OTA_DONE);
      continue;
    }
    if(!peerOnline(i)) continue;
    return peerGitOta(i, use);
  }
  return !one;
}
void MeshController::loopFollow() {
  if(!isRouter() || !otaFollow || !otaTag[0]) return;
  uint32_t now = millis();
  if(now < 12000) return;
  if(now > 12 * 60 * 1000UL) { clearFollow(); return; }
  if(otaUp.open) return;
  if(now - lastOtaKick < 4000) return;
  bool behind = false;
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
    if(!peers[i].serverId[0]) continue;
    if(peers[i].fw[0] && !strcmp(peers[i].fw, otaTag)) {
      setPeerPhase(i, MESH_OTA_DONE);
      continue;
    }
    if(peers[i].otaPhase == MESH_OTA_FAILED && peers[i].otaTries >= 3) continue;
    if(peers[i].otaPhase == MESH_OTA_FLASHING || peers[i].otaPhase == MESH_OTA_REBOOTING) {
      if((int32_t)(now - peers[i].otaUntil) < 0) { behind = true; continue; }
      peers[i].otaPhase = MESH_OTA_IDLE;
    }
    behind = true;
    if(!peerOnline(i)) continue;
    lastOtaKick = now;
    peerGitOta(i, otaTag);
    return;
  }
  if(!behind) clearFollow();
}
void MeshController::toPushStatus(JsonResponse &json) {
  json.addElem("follow", otaFollow);
  json.addElem("tag", otaTag);
  json.beginArray("peers");
  for(uint8_t i = 0; i < MESH_MAX_PEERS; i++) {
    if(!peers[i].serverId[0]) continue;
    json.beginObject();
    json.addElem("id", peers[i].serverId);
    json.addElem("hostname", peers[i].hostname);
    json.addElem("fw", peers[i].fw);
    json.addElem("online", peerOnline(i));
    json.addElem("phase", phaseName(peers[i].otaPhase));
    json.addElem("error", peers[i].otaErr);
    json.endObject();
  }
  json.endArray();
}

void MeshController::handlePushUpload(WebServer &server) {
  HTTPUpload &upload = server.upload();
  if(upload.status == UPLOAD_FILE_START) {
    otaUp.open = false;
    otaUp.ok = false;
    otaUp.idx = 255;
    otaUp.err[0] = 0;
    if(!isRouter()) { strlcpy(otaUp.err, "router-only", sizeof(otaUp.err)); return; }
    String id = server.arg("peer");
    String part = server.arg("part");
    int8_t x = findPeer(id.c_str());
    if(x < 0 || !peers[x].ip) { strlcpy(otaUp.err, "peer", sizeof(otaUp.err)); return; }
    if(!peerOnline((uint8_t)x)) { strlcpy(otaUp.err, "offline", sizeof(otaUp.err)); return; }
    otaUp.idx = (uint8_t)x;
    bool fs = part.equalsIgnoreCase("fs") || part.equalsIgnoreCase("app");
    const char *path = fs ? "/updateApplication" : "/updateFirmware?reboot=0";
    const char *fname = fs ? "SomfyController.littlefs.bin" : "SomfyController.ino.esp32.bin";
    char key[65];
    setPeerPhase((uint8_t)x, MESH_OTA_FLASHING);
    if(!peerLogin(peers[x].ip, key, sizeof(key))) {
      setPeerPhase((uint8_t)x, MESH_OTA_FAILED, "login");
      strlcpy(otaUp.err, "login", sizeof(otaUp.err));
      return;
    }
    IPAddress a(peers[x].ip);
    otaCliStop();
    otaUp.cli = new WiFiClient();
    if(!otaUp.cli || !otaUp.cli->connect(a, 80)) {
      setPeerPhase((uint8_t)x, MESH_OTA_FAILED, "connect");
      strlcpy(otaUp.err, "connect", sizeof(otaUp.err));
      otaCliStop();
      return;
    }
    otaUp.cli->setTimeout(20000);
    size_t fileSz = upload.totalSize;
    if(server.hasArg("size")) fileSz = (size_t)strtoul(server.arg("size").c_str(), nullptr, 10);
    if(!fileSz) {
      setPeerPhase((uint8_t)x, MESH_OTA_FAILED, "size");
      strlcpy(otaUp.err, "size", sizeof(otaUp.err));
      otaCliStop();
      return;
    }
    char pre[192];
    int preLen = snprintf(pre, sizeof(pre),
      "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\nContent-Type: application/octet-stream\r\n\r\n",
      MESH_OTA_BOUNDARY, fname);
    char post[48];
    int postLen = snprintf(post, sizeof(post), "\r\n--%s--\r\n", MESH_OTA_BOUNDARY);
    size_t clen = (size_t)preLen + fileSz + (size_t)postLen;
    otaUp.cli->printf("POST %s HTTP/1.1\r\nHost: %u.%u.%u.%u\r\nConnection: close\r\n", path, a[0], a[1], a[2], a[3]);
    if(key[0]) otaUp.cli->printf("apikey: %s\r\n", key);
    otaUp.cli->printf("Content-Type: multipart/form-data; boundary=%s\r\nContent-Length: %u\r\n\r\n", MESH_OTA_BOUNDARY, (unsigned)clen);
    otaUp.cli->write((uint8_t*)pre, preLen);
    otaUp.open = true;
    otaUp.ok = true;
  }
  else if(upload.status == UPLOAD_FILE_WRITE) {
    if(!otaUp.open || !otaUp.ok || !otaUp.cli) return;
    esp_task_wdt_reset();
    size_t n = otaUp.cli->write(upload.buf, upload.currentSize);
    if(n != upload.currentSize) {
      otaCliStop();
      otaUp.open = false;
      otaUp.ok = false;
      strlcpy(otaUp.err, "write", sizeof(otaUp.err));
      if(otaUp.idx < MESH_MAX_PEERS) setPeerPhase(otaUp.idx, MESH_OTA_FAILED, "write");
    }
  }
  else if(upload.status == UPLOAD_FILE_ABORTED) {
    otaCliStop();
    otaUp.open = false;
    otaUp.ok = false;
    strlcpy(otaUp.err, "abort", sizeof(otaUp.err));
    if(otaUp.idx < MESH_MAX_PEERS) setPeerPhase(otaUp.idx, MESH_OTA_FAILED, "abort");
  }
  else if(upload.status == UPLOAD_FILE_END) {
    if(!otaUp.open || !otaUp.cli) return;
    bool fs = server.arg("part").equalsIgnoreCase("fs") || server.arg("part").equalsIgnoreCase("app");
    char post[48];
    int postLen = snprintf(post, sizeof(post), "\r\n--%s--\r\n", MESH_OTA_BOUNDARY);
    otaUp.cli->write((uint8_t*)post, postLen);
    otaUp.cli->flush();
    String line;
    uint32_t start = millis();
    int code = 0;
    while(otaUp.cli->connected() && millis() - start < 25000) {
      esp_task_wdt_reset();
      line = otaUp.cli->readStringUntil('\n');
      if(line.startsWith("HTTP/")) { code = line.substring(9).toInt(); break; }
      if(!line.length()) delay(5);
    }
    otaCliStop();
    otaUp.open = false;
    otaUp.ok = (code >= 200 && code < 300);
    if(!otaUp.ok) {
      snprintf(otaUp.err, sizeof(otaUp.err), "http %d", code);
      if(otaUp.idx < MESH_MAX_PEERS) setPeerPhase(otaUp.idx, MESH_OTA_FAILED, otaUp.err);
    } else if(otaUp.idx < MESH_MAX_PEERS) {
      setPeerPhase(otaUp.idx, fs ? MESH_OTA_REBOOTING : MESH_OTA_FLASHING);
    }
  }
}
void MeshController::handlePushUpdate(WebServer &server) {
  if(server.method() == HTTP_OPTIONS) { server.send(200, "OK"); return; }
  if((otaUp.err[0] && !otaUp.ok && !server.hasArg("plain")) || (otaUp.idx != 255 && otaUp.err[0] && !otaUp.ok)) {
    char msg[96];
    snprintf(msg, sizeof(msg), "{\"status\":\"ERROR\",\"desc\":\"%s\"}", otaUp.err[0] ? otaUp.err : "Repeater update failed");
    server.send(500, "application/json", msg);
    otaUp.idx = 255;
    otaUp.err[0] = 0;
    otaUp.ok = false;
    return;
  }
  if(otaUp.ok && otaUp.idx != 255 && !server.hasArg("plain")) {
    JsonResponse resp;
    resp.beginResponse(&server, meshJsonBuf, sizeof(meshJsonBuf));
    resp.beginObject();
    resp.addElem("status", "SUCCESS");
    resp.addElem("peer", peers[otaUp.idx].serverId);
    resp.addElem("phase", phaseName(peers[otaUp.idx].otaPhase));
    resp.endObject();
    resp.endResponse();
    otaUp.idx = 255;
    otaUp.ok = false;
    return;
  }
  if(!isRouter()) {
    server.send(403, "application/json", "{\"status\":\"ERROR\",\"desc\":\"Router only\"}");
    return;
  }
  String bodyStr = server.arg("plain");
  const char *body = bodyStr.c_str();
  char peer[12] = "all", ver[32] = "";
  jsonStr(body, "peer", peer, sizeof(peer));
  jsonStr(body, "ver", ver, sizeof(ver));
  if(!ver[0] || !strcmp(ver, "current")) strlcpy(ver, settings.fwVersion.name, sizeof(ver));
  bool follow = jsonTrue(body, "follow");
  bool now = jsonTrue(body, "now");
  if(follow) setFollowTag(ver, true);
  bool ok = true;
  if(now || (!follow && ver[0] && body[0])) ok = triggerGitOta(peer, ver);
  JsonResponse resp;
  resp.beginResponse(&server, meshJsonBuf, sizeof(meshJsonBuf));
  resp.beginObject();
  resp.addElem("status", ok || follow ? "SUCCESS" : "ERROR");
  toPushStatus(resp);
  resp.endObject();
  resp.endResponse();
}
void MeshController::handleApi(WebServer &server) {
  if(server.method() == HTTP_OPTIONS) { server.send(200, "OK"); return; }
  String uri = server.uri();
  if(uri == "/mesh/state" && server.method() == HTTP_GET) {
    JsonResponse resp;
    resp.beginResponse(&server, meshJsonBuf, sizeof(meshJsonBuf));
    resp.beginObject();
    toJSON(resp);
    resp.endObject();
    resp.endResponse();
    return;
  }
  if(uri == "/mesh/pushStatus" && server.method() == HTTP_GET) {
    JsonResponse resp;
    resp.beginResponse(&server, meshJsonBuf, sizeof(meshJsonBuf));
    resp.beginObject();
    toPushStatus(resp);
    resp.endObject();
    resp.endResponse();
    return;
  }
  if(server.method() != HTTP_POST && server.method() != HTTP_PUT) { server.send(405); return; }
  String bodyStr = server.arg("plain");
  const char *body = bodyStr.c_str();
  if(uri == "/mesh/role") {
    uint8_t nr = (uint8_t)jsonInt(body, "role", (int)role);
    if(nr <= 2) role = (mesh_role_t)nr;
    uint8_t tm = (uint8_t)jsonInt(body, "txMode", (int)txMode);
    if(tm <= 1) txMode = (mesh_txmode_t)tm;
    char rid[10] = "";
    jsonStr(body, "routerId", rid, sizeof(rid));
    if(rid[0]) strlcpy(routerId, rid, sizeof(routerId));
    char ips[20] = "";
    jsonStr(body, "routerIp", ips, sizeof(ips));
    if(ips[0] && strchr(ips, '.')) {
      IPAddress a;
      if(a.fromString(ips)) routerIp = (uint32_t)a;
    }
    char pass[65] = "", user[33] = "";
    jsonStr(body, "pass", pass, sizeof(pass));
    jsonStr(body, "user", user, sizeof(user));
    if(pass[0]) {
      strlcpy(settings.Security.password, pass, sizeof(settings.Security.password));
      if(user[0]) strlcpy(settings.Security.username, user, sizeof(settings.Security.username));
      settings.Security.type = security_types::Password;
      settings.Security.save();
    }
    save();
    if(isRepeater() && routerIp) {
      char mac[18], js[200];
      localMacStr(mac, sizeof(mac));
      snprintf(js, sizeof(js), "{\"t\":\"pair\",\"id\":\"%s\",\"host\":\"%s\",\"fw\":\"%s\",\"mac\":\"%s\"}",
        settings.serverId, settings.hostname, settings.fwVersion.name, mac);
      queueOut(routerIp, js);
      flushOut();
    }
  }
  else if(uri == "/mesh/txMode") {
    uint8_t tm = (uint8_t)jsonInt(body, "txMode", 255);
    if(tm <= 1) txMode = (mesh_txmode_t)tm;
    save();
  }
  else if(uri == "/mesh/unpair") {
    char id[10] = "";
    jsonStr(body, "id", id, sizeof(id));
    int8_t x = findPeer(id);
    if(x >= 0) {
      memset(&peers[x], 0, sizeof(peers[x]));
      uint8_t slot = (uint8_t)(x + 1);
      for(uint8_t i = 1; i <= SOMFY_MAX_ROOMS; i++)
        if(roomRadio[i] == slot) roomRadio[i] = MESH_RADIO_AUTO;
    }
    save();
  }
  else if(uri == "/mesh/peerName") {
    char id[10] = "", host[32] = "";
    jsonStr(body, "id", id, sizeof(id));
    jsonStr(body, "hostname", host, sizeof(host));
    int8_t x = findPeer(id);
    bool ok = x >= 0 && host[0] && strlen(host) < sizeof(peers[x].hostname);
    if(ok) {
      for(const char *p = host; *p; p++) {
        char c = *p;
        if(!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-')) { ok = false; break; }
      }
    }
    if(ok) {
      strlcpy(peers[x].hostname, host, sizeof(peers[x].hostname));
      save();
      queuePeerName((uint8_t)x);
    }
  }
  else if(uri == "/mesh/roomRadio") {
    int rid = jsonInt(body, "roomId", 0);
    int rad = jsonInt(body, "radio", -1);
    if(rid >= 1 && rid <= SOMFY_MAX_ROOMS &&
       (rad == MESH_RADIO_AUTO || (rad >= 0 && rad <= MESH_MAX_PEERS)))
      roomRadio[rid] = (uint8_t)rad;
    save();
  }
  else if(uri == "/mesh/resetRanks") {
    for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
      ranks[i].shadeId = 255;
      for(uint8_t j = 0; j < MESH_MAX_PEERS + 1; j++) ranks[i].rssi[j] = -127;
    }
    save();
  }
  else if(uri == "/mesh/resetOriginal") {
    resetOriginal();
  }
  JsonResponse resp;
  resp.beginResponse(&server, meshJsonBuf, sizeof(meshJsonBuf));
  resp.beginObject();
  toJSON(resp);
  resp.endObject();
  resp.endResponse();
}
