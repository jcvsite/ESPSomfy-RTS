/**
 * AlexaHue.h — Optional fake Philips Hue bridge for Alexa (Router only).
 * Exposes manually selected shades as dimmable lights (on/off + brightness = position).
 */
#ifndef ALEXA_HUE_H
#define ALEXA_HUE_H

#include <Arduino.h>
#include <WebServer.h>
#include <AsyncUDP.h>

#ifndef ALEXA_HUE_MAX_DEVICES
#define ALEXA_HUE_MAX_DEVICES 24
#endif

class AlexaHueBridge {
public:
  void begin(WebServer *server);
  void loop();
  void applySettings();
  void rebuildDevices();
  bool handleHttp(WebServer &server);
  void onSsdpSearch(AsyncUDPPacket &packet, const char *st);
  uint8_t exposedCount() const { return deviceCount; }
  uint8_t maxDevices() const { return ALEXA_HUE_MAX_DEVICES; }
  bool isActive() const { return active; }

private:
  struct Device {
    uint8_t shadeId = 255;
    char name[33] = "";
    uint8_t bri = 0; // 0 = off/closed, 1..255 open amount
  };

  WebServer *http = nullptr;
  bool active = false;
  uint8_t deviceCount = 0;
  Device devices[ALEXA_HUE_MAX_DEVICES];
  char macEsc[13] = "";
  uint32_t mac24 = 0;

  void refreshMac();
  int encodeLightKey(uint8_t idx) const;
  uint8_t decodeLightKey(int key) const;
  void sendDescription(WebServer &server);
  void sendLightsList(WebServer &server);
  void sendOneLight(WebServer &server, uint8_t idx);
  void handleStatePut(WebServer &server, uint8_t idx, const String &body);
  void applyBrightness(uint8_t idx, uint8_t bri, bool isOn);
  void deviceJson(uint8_t idx, char *buf, size_t buflen);
  void sendHueSsdp(IPAddress addr, uint16_t port);
};

extern AlexaHueBridge alexaHue;

#endif
