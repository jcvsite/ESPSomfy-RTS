/**
 * AlexaHue.cpp — Minimal Philips Hue API + SSDP replies for Alexa discovery.
 */
#include "AlexaHue.h"
#include "ConfigSettings.h"
#include "Somfy.h"
#include "Mesh.h"
#include "AlexaHue.h"
#include "SSDP.h"
#include <WiFi.h>
#include <stdio.h>
#include <string.h>
#include <ctype.h>

extern ConfigSettings settings;
extern SomfyShadeController somfy;
extern MeshController mesh;

AlexaHueBridge alexaHue;

void AlexaHueBridge::refreshMac() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(macEsc, sizeof(macEsc), "%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  mac24 = ((uint32_t)mac[3] << 16) | ((uint32_t)mac[4] << 8) | mac[5];
}

int AlexaHueBridge::encodeLightKey(uint8_t idx) const {
  return (int)((mac24 << 7) | (idx & 127));
}

uint8_t AlexaHueBridge::decodeLightKey(int key) const {
  if (((uint32_t)key >> 7) != mac24) return 255;
  return (uint8_t)(key & 127);
}

void AlexaHueBridge::begin(WebServer *server) {
  http = server;
  refreshMac();
  applySettings();
}

void AlexaHueBridge::applySettings() {
  bool want = settings.alexaHueEnabled && mesh.isRouter();
  if (want && !active) {
    rebuildDevices();
    active = true;
    Serial.printf("Alexa Hue bridge on (%u lights, max %u, heap %u)\n",
                  (unsigned)deviceCount, (unsigned)ALEXA_HUE_MAX_DEVICES,
                  (unsigned)ESP.getFreeHeap());
  } else if (!want && active) {
    active = false;
    deviceCount = 0;
    Serial.println("Alexa Hue bridge off");
  } else if (want && active) {
    rebuildDevices();
  }
}

void AlexaHueBridge::rebuildDevices() {
  deviceCount = 0;
  if (!settings.alexaHueEnabled || !mesh.isRouter()) return;
  refreshMac();
  for (uint8_t i = 0; i < SOMFY_MAX_SHADES && deviceCount < ALEXA_HUE_MAX_DEVICES; i++) {
    SomfyShade *sh = &somfy.shades[i];
    if (sh->getShadeId() == 255 || !sh->exposeAlexa) continue;
    if (sh->shadeType == shade_types::drycontact || sh->shadeType == shade_types::drycontact2)
      continue;
    Device &d = devices[deviceCount];
    d.shadeId = sh->getShadeId();
    strncpy(d.name, sh->name, sizeof(d.name) - 1);
    d.name[sizeof(d.name) - 1] = '\0';
    if (!d.name[0]) snprintf(d.name, sizeof(d.name), "Shade %u", (unsigned)d.shadeId);
    int8_t ha = sh->transformPosition(sh->currentPos);
    if (ha < 0) ha = 0;
    if (ha > 100) ha = 100;
    d.bri = (uint8_t)((ha * 255) / 100);
    if (d.bri > 0 && d.bri < 255) { /* keep */ }
    deviceCount++;
  }
}

void AlexaHueBridge::loop() {
  // HTTP is handled via WebServer; SSDP replies are hooked from SSDPClass.
}

void AlexaHueBridge::sendHueSsdp(IPAddress addr, uint16_t port) {
  if (!active) return;
  IPAddress ip = WiFi.localIP();
  if ((uint32_t)ip == 0) return;
  char buf[512];
  snprintf(buf, sizeof(buf),
           "HTTP/1.1 200 OK\r\n"
           "EXT:\r\n"
           "CACHE-CONTROL: max-age=100\r\n"
           "LOCATION: http://%u.%u.%u.%u:80/description.xml\r\n"
           "SERVER: FreeRTOS/6.0.5, UPnP/1.0, IpBridge/1.17.0\r\n"
           "hue-bridgeid: %s\r\n"
           "ST: urn:schemas-upnp-org:device:basic:1\r\n"
           "USN: uuid:2f402f80-da50-11e1-9b23-%s::upnp:rootdevice\r\n"
           "\r\n",
           ip[0], ip[1], ip[2], ip[3], macEsc, macEsc);
  SSDP.writeRaw(addr, port, buf);
}

void AlexaHueBridge::onSsdpSearch(AsyncUDPPacket &packet, const char *st) {
  if (!active || !st) return;
  bool match =
      strcmp(st, "ssdp:all") == 0 ||
      strcmp(st, "upnp:rootdevice") == 0 ||
      strstr(st, "device:basic:1") != nullptr ||
      strstr(st, "IpBridge") != nullptr;
  if (!match) return;
  sendHueSsdp(packet.remoteIP(), packet.remotePort());
}

void AlexaHueBridge::sendDescription(WebServer &server) {
  IPAddress ip = WiFi.localIP();
  char buf[768];
  snprintf(buf, sizeof(buf),
           "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
           "<root xmlns=\"urn:schemas-upnp-org:device-1-0\">"
           "<specVersion><major>1</major><minor>0</minor></specVersion>"
           "<URLBase>http://%u.%u.%u.%u:80/</URLBase>"
           "<device>"
           "<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>"
           "<friendlyName>ESPSomfy Hue (%u.%u.%u.%u)</friendlyName>"
           "<manufacturer>Royal Philips Electronics</manufacturer>"
           "<manufacturerURL>http://www.philips.com</manufacturerURL>"
           "<modelDescription>Philips hue Personal Wireless Lighting</modelDescription>"
           "<modelName>Philips hue bridge 2012</modelName>"
           "<modelNumber>929000226503</modelNumber>"
           "<modelURL>http://www.meethue.com</modelURL>"
           "<serialNumber>%s</serialNumber>"
           "<UDN>uuid:2f402f80-da50-11e1-9b23-%s</UDN>"
           "<presentationURL>index.html</presentationURL>"
           "</device></root>",
           ip[0], ip[1], ip[2], ip[3],
           ip[0], ip[1], ip[2], ip[3],
           macEsc, macEsc);
  server.send(200, "text/xml", buf);
}

void AlexaHueBridge::deviceJson(uint8_t idx, char *buf, size_t buflen) {
  Device &d = devices[idx];
  char uid[40];
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(uid, sizeof(uid), "%02X:%02X:%02X:%02X:%02X:%02X-%02X-00:11",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], idx);
  uint8_t briOut = d.bri == 0 ? 0 : (d.bri == 255 ? 254 : (d.bri > 1 ? d.bri - 1 : 0));
  snprintf(buf, buflen,
           "{\"state\":{\"on\":%s,\"bri\":%u,\"alert\":\"none\",\"mode\":\"homeautomation\",\"reachable\":true},"
           "\"type\":\"Dimmable light\",\"name\":\"%s\",\"modelid\":\"LWB010\","
           "\"manufacturername\":\"Philips\",\"productname\":\"E1\","
           "\"uniqueid\":\"%s\",\"swversion\":\"espsomfy-hue\"}",
           d.bri > 0 ? "true" : "false", briOut, d.name, uid);
}

void AlexaHueBridge::sendLightsList(WebServer &server) {
  // Stream to avoid one giant String peak.
  WiFiClient client = server.client();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "application/json", "");
  client.print('{');
  for (uint8_t i = 0; i < deviceCount; i++) {
    if (i) client.print(',');
    client.printf("\"%d\":", encodeLightKey(i));
    char buf[512];
    deviceJson(i, buf, sizeof(buf));
    client.print(buf);
  }
  client.print('}');
  client.stop();
}

void AlexaHueBridge::sendOneLight(WebServer &server, uint8_t idx) {
  if (idx >= deviceCount) {
    server.send(200, "application/json", "{}");
    return;
  }
  char buf[512];
  deviceJson(idx, buf, sizeof(buf));
  server.send(200, "application/json", buf);
}

void AlexaHueBridge::applyBrightness(uint8_t idx, uint8_t bri, bool isOn) {
  if (idx >= deviceCount) return;
  Device &d = devices[idx];
  SomfyShade *sh = somfy.getShadeById(d.shadeId);
  if (!sh) return;
  if (!isOn || bri == 0) {
    d.bri = 0;
    if (sh->isToggle()) {
      // Toggle types: treat off as close/toggle toward closed when possible.
      sh->sendCommand(somfy_commands::Down);
    } else {
      int8_t native = sh->transformPosition(0.0f);
      sh->moveToTarget((float)native);
    }
    return;
  }
  if (bri > 255) bri = 255;
  d.bri = bri;
  uint8_t pct = (uint8_t)((bri * 100) / 255);
  if (pct > 100) pct = 100;
  if (sh->isToggle()) {
    sh->sendCommand(somfy_commands::Up);
  } else {
    int8_t native = sh->transformPosition((float)pct);
    sh->moveToTarget((float)native);
  }
}

void AlexaHueBridge::handleStatePut(WebServer &server, uint8_t idx, const String &body) {
  if (idx >= deviceCount) {
    server.send(200, "application/json", "[{}]");
    return;
  }
  bool hasOn = body.indexOf("\"on\"") >= 0 || body.indexOf("on") >= 0;
  bool turnOff = body.indexOf("false") >= 0;
  bool turnOn = body.indexOf("true") >= 0;
  int briPos = body.indexOf("bri");
  int briVal = -1;
  if (briPos >= 0) {
    // bri":123 or bri:123
    const char *p = body.c_str() + briPos;
    while (*p && !isdigit((unsigned char)*p)) p++;
    if (*p) briVal = atoi(p);
  }
  if (briVal >= 0) {
    uint8_t b = (uint8_t)(briVal >= 254 ? 255 : briVal + 1);
    applyBrightness(idx, b, true);
  } else if (turnOff) {
    applyBrightness(idx, 0, false);
  } else if (turnOn || hasOn) {
    uint8_t b = devices[idx].bri > 0 ? devices[idx].bri : 255;
    applyBrightness(idx, b, true);
  }
  server.send(200, "application/json", "[{\"success\":true}]");
}

bool AlexaHueBridge::handleHttp(WebServer &server) {
  if (!active) return false;
  String uri = server.uri();
  if (uri == "/description.xml") {
    sendDescription(server);
    return true;
  }
  if (uri.indexOf("/api") < 0) return false;

  String body = server.hasArg("plain") ? server.arg("plain") : "";
  if (body.indexOf("devicetype") >= 0) {
    server.send(200, "application/json",
                F("[{\"success\":{\"username\":\"ESPSomfyAlexaUser\"}}]"));
    return true;
  }

  // .../lights/<id>/state
  int lights = uri.indexOf("/lights");
  if (lights < 0) {
    server.send(200, "application/json", "{}");
    return true;
  }
  String rest = uri.substring(lights + 7); // after /lights
  while (rest.startsWith("/")) rest = rest.substring(1);
  if (rest.length() == 0 || rest == "/") {
    sendLightsList(server);
    return true;
  }
  int slash = rest.indexOf('/');
  String idStr = slash >= 0 ? rest.substring(0, slash) : rest;
  int key = idStr.toInt();
  uint8_t idx = decodeLightKey(key);
  // Also accept 1-based simple indices for debugging
  if (idx >= deviceCount && key >= 1 && key <= deviceCount) idx = (uint8_t)(key - 1);

  if (slash >= 0 && rest.substring(slash + 1).startsWith("state")) {
    handleStatePut(server, idx, body);
    return true;
  }
  sendOneLight(server, idx);
  return true;
}
