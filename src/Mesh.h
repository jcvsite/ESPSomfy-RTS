/**
 * Mesh.h — Mesh controller API, peer slots, and heartbeat/OTA phase constants.
 */

#ifndef mesh_h
#define mesh_h
#include <Arduino.h>
#include <FS.h>
#include <WebServer.h>
#include "WResp.h"
#include "Somfy.h"

#define MESH_MAX_PEERS 4
#define MESH_MAX_HEARD 4
#define MESH_MAX_OUT 8
#define MESH_MAX_LISTEN 16
#define MESH_UDP_PORT 19847
#define MESH_HB_MS 3000
#define MESH_OFFLINE_MS 10000
#define MESH_MIN_RANK_RSSI -85
#define MESH_HYSTERESIS_DB 6
#define MESH_RADIO_AUTO 255
#define MESH_OTA_IDLE 0
#define MESH_OTA_QUEUED 1
#define MESH_OTA_FLASHING 2
#define MESH_OTA_REBOOTING 3
#define MESH_OTA_DONE 4
#define MESH_OTA_FAILED 5

enum mesh_role_t : uint8_t { MESH_UNSET = 0, MESH_ROUTER = 1, MESH_REPEATER = 2 };
enum mesh_txmode_t : uint8_t { MESH_BLAST = 0, MESH_ASSIGN = 1 };

struct mesh_peer_t {
  char serverId[10];
  char hostname[32];
  char fw[16];
  uint32_t ip;
  uint32_t lastHb;
  uint32_t uptime;
  uint32_t heap;
  int16_t lastRssi;
  uint32_t lastAddr;
  uint8_t onlineHits;
  char mac[18];
  uint32_t lastCfgMs;
  uint8_t otaPhase;
  uint8_t otaTries;
  uint32_t otaUntil;
  char otaErr[40];
};

struct mesh_rank_t {
  uint8_t shadeId;
  int16_t rssi[MESH_MAX_PEERS + 1]; // 0 = this/router
};
struct mesh_listen_t {
  uint32_t addr;
  int16_t rssi[MESH_MAX_PEERS + 1];
  uint32_t lastMs;
};
struct mesh_heard_t {
  char id[10];
  char host[32];
  char fw[16];
  uint32_t ip;
  uint32_t last;
  uint8_t role;
  uint8_t auth;
};

class MeshController {
  public:
    mesh_role_t role;
    mesh_txmode_t txMode;
    char routerId[10];
    uint32_t routerIp;
    uint32_t routerLastHb;
    mesh_peer_t peers[MESH_MAX_PEERS];
    mesh_rank_t ranks[SOMFY_MAX_SHADES];
    // 255 = Auto (best), 0 = this unit, 1+ = slave slot
    uint8_t roomRadio[SOMFY_MAX_ROOMS + 1];
    mesh_heard_t heard[MESH_MAX_HEARD];
    char assignedList[160];
    char routerHost[32];
    bool begin();
    void loop();
    bool save();
    bool load();
    bool appendToBackup(File &dst);
    bool restoreFromBackup();
    void resetOriginal();
    bool isRouter() const { return role == MESH_ROUTER; }
    bool isRepeater() const { return role == MESH_REPEATER; }
    bool keepSetupHotspot() const;
    bool shouldLocalTx(uint32_t address);
    void relayTx(somfy_frame_t &frame, uint8_t repeat);
    bool onLocalRx(somfy_frame_t &frame);
    void bindListen(uint32_t addr);
    void handleHttp(WebServer &server);
    void handleApi(WebServer &server);
    void toJSON(JsonResponse &json);
    void syncSettingsToPeers(const char *oldPass = nullptr);
    bool peerOnline(uint8_t i) const;
    bool setFollowTag(const char *tag, bool on);
    void clearFollow();
    bool triggerGitOta(const char *peerId, const char *tag);
    void handlePushUpdate(WebServer &server);
    void handlePushUpload(WebServer &server);
    void toPushStatus(JsonResponse &json);
  private:
    void queueSync(uint32_t ip);
    void queuePeerName(uint8_t idx);
    uint32_t lastBeacon;
    uint32_t lastHbOut;
    uint32_t lastRxAddr;
    uint16_t lastRxCode;
    uint32_t lastRxMs;
    uint8_t outN;
    uint32_t outIp[MESH_MAX_OUT];
    char outJson[MESH_MAX_OUT][440];
    mesh_listen_t listen[MESH_MAX_LISTEN];
    bool ranksDirty;
    uint32_t lastRankSave;
    void deriveKey(uint8_t key[32]);
    bool wrap(const char *plain, char *out, size_t outSz);
    bool unwrap(const char *in, char *plain, size_t plainSz);
    void queueOut(uint32_t ip, const char *json);
    void flushOut();
    void sendBeacon();
    void pollUdp();
    void sendHeartbeat();
    int8_t findPeer(const char *id);
    int8_t addPeer(const char *id, const char *host, uint32_t ip, const char *fw);
    mesh_rank_t *rankFor(uint8_t shadeId, bool create);
    int8_t pickOwn(uint8_t shadeId);
    int8_t pickWant(uint8_t shadeId);
    int8_t pickRadio(uint8_t shadeId);
    int8_t pickRadioForRoom(uint8_t roomId);
    int8_t radioForTx(uint32_t address);
    bool hasOwnRank(uint8_t shadeId);
    bool heardAny(uint8_t shadeId);
    void noteRssi(uint8_t shadeId, const char *heardBy, int16_t rssi);
    void noteRssiCluster(uint32_t addr, const char *heardBy, int16_t rssi);
    int8_t radioIdx(const char *heardBy);
    mesh_listen_t *listenSlot(uint32_t addr, bool create);
    void noteListen(uint32_t addr, const char *heardBy, int16_t rssi);
    void applyInner(const char *plain, uint32_t fromIp, char *reply, size_t replySz);
    void noteHeard(uint8_t rle, const char *id, const char *host, const char *fw, uint32_t ip, uint8_t auth);
    void loadFollow();
    void loopFollow();
    bool peerLogin(uint32_t ip, char *apiKey, size_t keySz);
    bool peerGitOta(uint8_t idx, const char *tag);
    bool otaPartitionOk(const char *peerFw, const char *tag);
    void setPeerPhase(uint8_t idx, uint8_t phase, const char *err = nullptr);
    const char *phaseName(uint8_t phase) const;
    char otaTag[32];
    bool otaFollow;
    uint32_t lastOtaKick;
};

extern MeshController mesh;
#endif
