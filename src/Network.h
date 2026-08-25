/**
 * Network.h — Network connection helpers and SoftAP/reconnect policy.
 */

#ifndef Network_h
#define Network_h

#include <Arduino.h>

#define CONNECT_TIMEOUT 20000
#define SSID_SCAN_INTERVAL 30000
#define SSID_RETRY_INTERVAL 15000      // reconnect attempt cadence while SoftAP is down
#define SOFTAP_STA_GRACE_MS 180000     // try saved SSID for 3 min before opening SoftAP
#define SOFTAP_SETUP_GRACE_MS 30000    // unpaired Repeater / first setup: SoftAP after 30 s
#define SOFTAP_BOOT_DELAY_MS 5000      // brief settle before SoftAP when no SSID (first-time setup)
#define SOFTAP_BOOT_DELAY_MS 5000      // brief settle before SoftAP when no SSID (first-time setup)
#define SOFTAP_SETUP_IDLE_MS 300000    // SoftAP recovery window (5 min idle)

class Network {
protected:
  uint32_t lastEmit = 0;
  uint32_t lastMDNS = 0;
  int lastRSSI = 0;
  int lastChannel = 0;
  int linkSpeed = 0;
public:
  // Regroupement des booléens (Gain de place RAM/Alignement)
  bool _connecting = false;
  bool ethStarted = false;
  bool wifiFallback = false;
  bool softAPOpened = false;
  bool openingSoftAP = false;
  // Set after successful STA/ETH connect: SoftAP stays off until reboot (or Wi‑Fi reconfigured).
  bool softApDisabled = false;
  bool needsBroadcast = true;

  uint32_t lastWifiScan = 0;
  uint32_t lastStaRetry = 0;     // last STA reconnect kick (15 s cadence)
  uint32_t softApIdleSince = 0;  // 0 = paused (client connected)
  conn_types_t connType = conn_types_t::unset;
  conn_types_t connTarget = conn_types_t::unset;

  bool connected();
  bool connecting();
  void clearConnecting();
  conn_types_t preferredConnType();

  char ssid[33]; // SSID max 32 car. + \0
  char mac[18];  // MAC max 17 car. + \0

  int channel;
  int strength;
  int disconnected = 0;
  int connectAttempts = 0;
  uint32_t disconnectTime = 0;
  uint32_t connectStart = 0;
  uint32_t connectTime = 0;
  uint32_t connectedAt = 0;

  bool openSoftAP();
  void closeSoftAPForScan();
  bool connect(conn_types_t ctype);
  bool connectWiFi(const uint8_t *bssid = nullptr, const int32_t channel = -1);
  bool connectWired();
  void setConnected(conn_types_t connType);
  bool getStrongestAP(const char *ssid, uint8_t *bssid, int32_t *channel);
  bool changeAP(const uint8_t *bssid, const int32_t channel);
  void updateHostname();
  bool setup();
  void loop();
  void end();
  void emitSockets();
  void emitSockets(uint8_t num);
  void emitHeap(uint8_t num = 255);
  uint32_t getChipId();
  static void networkEvent(WiFiEvent_t event);
};
#endif
