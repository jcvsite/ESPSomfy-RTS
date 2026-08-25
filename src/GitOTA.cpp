/**
 * GitOTA.cpp — GitHub release download and dual-partition firmware/filesystem OTA.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <HTTPClient.h>
#include <esp_task_wdt.h>
#include <LittleFS.h>
#include "ConfigSettings.h"
#include "GitOTA.h"
#include "Utils.h"
#include "Sockets.h"
#include "Somfy.h"
#include "Web.h"
#include "WResp.h"
#include "Network.h"
#include "FixedCode.h"
#include "NoLog.h"
#include "MQTT.h"

extern ConfigSettings settings;
extern SocketEmitter sockEmit;
extern SomfyShadeController somfy;
extern rebootDelay_t rebootDelay;
extern Web webServer;
extern Network net;
extern FixedCodeController fixedCodes;
extern MQTTClass mqtt;

#define MAX_BUFF_SIZE 4096
void GitRelease::setReleaseProperty(const char *key, const char *val) {
  if(strcmp(key, "id") == 0) this->id = atol(val);
  else if(strcmp(key, "draft") == 0) this->draft = toBoolean(val, false);
  else if(strcmp(key, "prerelease") == 0) this->preRelease = toBoolean(val, false);
  else if(strcmp(key, "name") == 0) strlcpy(this->name, val, sizeof(this->name));
  else if(strcmp(key, "tag_name") == 0) {
    this->version.parse(val);
  }
  else if(strcmp(key, "published_at") == 0) {
    //Serial.printf("Key:[%s] Value:[%s]\n", key, val);
    this->releaseDate = Timestamp::parseUTCTime(val);
  }
}
static bool gitAssetMatchesChip(const char *name, const char *chip) {
  char exact[48];
  char prefixed[48];
  snprintf(exact, sizeof(exact), "ino.%s.bin", chip);
  snprintf(prefixed, sizeof(prefixed), "ino.%s-", chip);
  return strstr(name, exact) != nullptr || strstr(name, prefixed) != nullptr;
}

static void gitAddHwVersion(char *hwVersions, size_t hwSz, const char *token) {
  if(!hwVersions || !token) return;
  if(strlen(hwVersions) + strlen(token) + 2 >= hwSz) return;
  if(hwVersions[0]) strcat(hwVersions, ",");
  strcat(hwVersions, token);
}

/** Insert -<version> before the final extension: base.bin → base-v3.4.2.bin */
static void gitBuildVersionedAsset(char *out, size_t outSz, const char *baseName, const char *version) {
  if(!out || !outSz) return;
  if(!baseName || !baseName[0]) {
    out[0] = '\0';
    return;
  }
  if(!version || !version[0]) {
    strlcpy(out, baseName, outSz);
    return;
  }
  const char *dot = strrchr(baseName, '.');
  if(!dot || dot == baseName) {
    strlcpy(out, baseName, outSz);
    return;
  }
  char ver[24];
  if(version[0] == 'v' || version[0] == 'V')
    strlcpy(ver, version, sizeof(ver));
  else {
    ver[0] = 'v';
    strlcpy(ver + 1, version, sizeof(ver) - 1);
  }
  size_t stemLen = (size_t)(dot - baseName);
  snprintf(out, outSz, "%.*s-%s%s", (int)stemLen, baseName, ver, dot);
}

void GitRelease::setAssetProperty(const char *key, const char *val) {
  if(strcmp(key, "name") != 0 || !val) return;
  // Accept legacy names (…esp32.bin) and versioned names (…esp32-v3.4.2.bin).
  if(strstr(val, "littlefs") && strstr(val, ".bin")) {
    this->hasFS = true;
  }
  else if(gitAssetMatchesChip(val, "esp32wrover")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "wrover");
  else if(gitAssetMatchesChip(val, "esp32s3_8mb")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "s3_8mb");
  else if(gitAssetMatchesChip(val, "esp32s3_4mb")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "s3_4mb");
  else if(gitAssetMatchesChip(val, "esp32s2")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "s2");
  else if(gitAssetMatchesChip(val, "esp32c3")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "c3");
  else if(gitAssetMatchesChip(val, "esp32c2")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "c2");
  else if(gitAssetMatchesChip(val, "esp32c6")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "c6");
  else if(gitAssetMatchesChip(val, "esp32h2")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "h2");
  else if(gitAssetMatchesChip(val, "esp32")) gitAddHwVersion(this->hwVersions, sizeof(this->hwVersions), "32");
}
void GitRelease::toJSON(JsonResponse &json) {
  Timestamp ts;
  char buff[20];
  sprintf(buff, "%llu", this->id);
  json.addElem("id", buff);
  json.addElem("name", this->name);
  json.addElem("date", ts.getISOTime(this->releaseDate));
  json.addElem("draft", this->draft);
  json.addElem("preRelease", this->preRelease);
  json.addElem("main", this->main);
  json.addElem("hasFS", this->hasFS);
  json.addElem("hwVersions", this->hwVersions);
  json.beginObject("version");
  this->version.toJSON(json);
  json.endObject();
}
#define ERR_CLIENT_OFFSET -50

int16_t GitRepo::getReleases(uint8_t num) {
  WiFiClientSecure sclient;
  sclient.setInsecure();
  sclient.setHandshakeTimeout(3);
  uint8_t ndx = 0;
  uint8_t count = min((uint8_t)GIT_MAX_RELEASES, num);
  char url[128];
  memset(this->releases, 0x00, sizeof(GitRelease) * GIT_MAX_RELEASES);
  sprintf(url, "https://api.github.com/repos/" GITHUB_OWNER_REPO "/releases?per_page=%d&page=1", count);
  HTTPClient https;
  https.setReuse(false);
  if(https.begin(sclient, url)) {
    esp_task_wdt_reset();
    int httpCode = https.GET();
    Serial.printf("[HTTPS] GET... code: %d\n", httpCode);
    if(httpCode > 0) {
      int len = https.getSize();
      Serial.printf("[HTTPS] GET... code: %d - %d\n", httpCode, len);
      if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
        WiFiClient *stream = https.getStreamPtr();
        uint8_t buff[128] = {0};
        char jsonElem[32] = "";
        char jsonValue[128] = "";
        int arrTok = 0;
        int objTok = 0;
        bool inQuote = false;
        bool inElem = false;
        bool inValue = false;
        bool awaitValue = false;
        bool inAss = false;
        while(https.connected() && (len > 0 || len == -1) && ndx < count) {
          size_t size = stream->available();
          if(size) {
            esp_task_wdt_reset();
            int c = stream->readBytes(buff, ((size > sizeof(buff)) ? sizeof(buff) : size));
            //Serial.write(buff, c);
            if(len > 0) len -= c;
            // Now we should have some data.
            for(uint8_t i = 0; i < c; i++) {
              // Read the buffer a byte at a time until we have a key value pair.
              char ch = static_cast<char>(buff[i]);
              if(ch == '[') {
                arrTok++;
                if(arrTok == 2 && strcmp(jsonElem, "assets") == 0) {
                  inElem = inValue = awaitValue = false;
                  inAss = true;
                  //Serial.printf("%s: %d\n", jsonElem, arrTok);
                }
                else if(arrTok < 2) inAss = false;
              }
              else if(ch == ']') {
                arrTok--;
                if(arrTok < 2) inAss = false;
              }
              else if(ch == '{') {
                objTok++;
                if(objTok != 1 && !inAss) inElem = inValue = awaitValue = false;
              }
              else if(ch == '}') {
                objTok--;
                if(objTok == 0) ndx++;
              }
              else if(objTok == 1 || inAss) {
                // We only want data from the root object.
                //if(inAss) Serial.print(ch);
                if(ch == '\"') {
                  inQuote = !inQuote;
                  if(inElem) {
                    inElem = false;
                    awaitValue = true;
                  }
                  else if(inValue) {
                    inValue = false;
                    inElem = false;
                    awaitValue = false;
                    if(inAss)
                      this->releases[ndx].setAssetProperty(jsonElem, jsonValue);
                    else
                      this->releases[ndx].setReleaseProperty(jsonElem, jsonValue);
                    memset(jsonElem, 0x00, sizeof(jsonElem));
                    memset(jsonValue, 0x00, sizeof(jsonValue));
                  }
                  else if(awaitValue) inValue = true;
                  else {
                    inElem = true;
                    awaitValue = false;
                  }
                }
                else if(awaitValue) {
                  if(ch != ' ' && ch != ':') {
                    strncat(jsonValue, &ch, 1);
                    awaitValue = false;
                    inValue = true;
                  }
                }
                else if((!inQuote && ch == ',') || ch == '\r' || ch == '\n') {
                  inElem = inValue = awaitValue = false;
                  if(strlen(jsonElem) > 0) {
                    if(inAss)
                      this->releases[ndx].setAssetProperty(jsonElem, jsonValue);
                    else
                      this->releases[ndx].setReleaseProperty(jsonElem, jsonValue);
                  }
                  memset(jsonElem, 0x00, sizeof(jsonElem));
                  memset(jsonValue, 0x00, sizeof(jsonValue));
                }
                else {
                  if(inElem) {
                    if(strlen(jsonElem) < sizeof(jsonElem) - 1) strncat(jsonElem, &ch, 1);
                  }
                  else if(inValue) {
                    if(strlen(jsonValue) < sizeof(jsonValue) - 1) strncat(jsonValue, &ch, 1);
                  }
                }
              }
            }
            delay(1);
          }
          //else break;
        }
      }
      else {
        https.end();
        sclient.stop();
        return httpCode;
      }
    }
    https.end();
    sclient.stop();
  }
  settings.printAvailHeap();
  return 0;
}
void GitRepo::toJSON(JsonResponse &json) {
  json.beginObject("fwVersion");
  settings.fwVersion.toJSON(json);
  json.endObject();
  json.beginObject("appVersion");
  settings.appVersion.toJSON(json);
  json.endObject();
  json.beginArray("releases");
  for(uint8_t i = 0; i < GIT_MAX_RELEASES; i++) {
    if(this->releases[i].id == 0) continue;
    json.beginObject();
    this->releases[i].toJSON(json);
    json.endObject();
  }
  json.endArray();
}
#define UPDATE_ERR_OFFSET 20
#define ERR_DOWNLOAD_HTTP -40
#define ERR_DOWNLOAD_BUFFER -41
#define ERR_DOWNLOAD_CONNECTION -42

void GitUpdater::loop() {
  if(!net.connected()) return;
  if(this->status == GIT_STATUS_READY) {
    if(settings.checkForUpdate &&
      (millis() > net.connectTime + 60000) && // Wait a minute before checking after connection.
      (this->lastCheck + 86400000 < millis() || this->lastCheck == 0) && !rebootDelay.reboot) { // 1 day
        this->checkForUpdate();
      }
  }
  else if(this->status == GIT_AWAITING_UPDATE) {
    Serial.println("Starting update process....");
    this->status = GIT_UPDATING;
    this->beginUpdate(this->targetRelease);
    this->status = GIT_STATUS_READY;
    this->emitUpdateCheck();
  }
  else if(this->status == GIT_UPDATE_CANCELLING) {
    Serial.println("Cancelling update process....");
    if(!this->lockFS) {
      this->status = GIT_UPDATE_CANCELLED;
      this->cancelled = true;
      this->emitUpdateCheck();
    }
  }
}
void GitUpdater::checkForUpdate() {
  if(this->status != 0) return; // If we are already checking.
  Serial.println("Check github for updates...");

  this->status = GIT_STATUS_CHECK;
  settings.printAvailHeap();
  this->lastCheck = millis();
  if(this->checkInternet() == 0) {
    GitRepo repo;
    this->updateAvailable = false;
    this->error = repo.getReleases(2);
    if(this->error == 0) { // Get 2 releases so we can filter pre-releases
      this->setCurrentRelease(repo);
    }
    else {
      this->emitUpdateCheck();
    }
  }
  bool doAuto = this->updateAvailable && settings.autoInstallUpdate && this->latest.name[0];
  this->status = GIT_STATUS_READY;
  if(doAuto) {
    strlcpy(this->targetRelease, this->latest.name, sizeof(this->targetRelease));
    this->status = GIT_AWAITING_UPDATE;
  }
}
void GitUpdater::setCurrentRelease(GitRepo &repo) {
  this->updateAvailable = false;
  for(uint8_t i = 0; i < 2; i++) {
    if(repo.releases[i].draft || repo.releases[i].preRelease || repo.releases[i].id == 0) continue;
    // Compare the versions.
    this->latest.copy(repo.releases[i].version);
    if(repo.releases[i].version.compare(settings.fwVersion) > 0) {
      // We have a new release.
      this->updateAvailable = true;
    }
    break;
  }
  this->emitUpdateCheck();
}
void GitUpdater::toJSON(JsonResponse &json) {
  json.addElem("available", this->updateAvailable);
  json.addElem("status", this->status);
  json.addElem("error", (int32_t)this->error);
  json.addElem("cancelled", this->cancelled);
  json.addElem("checkForUpdate", settings.checkForUpdate);
  json.addElem("inetAvailable", this->inetAvailable);
  json.beginObject("fwVersion");
  settings.fwVersion.toJSON(json);
  json.endObject();
  json.beginObject("appVersion");
  settings.appVersion.toJSON(json);
  json.endObject();
  json.beginObject("latest");
  this->latest.toJSON(json);
  json.endObject();
}
void GitUpdater::emitUpdateCheck(uint8_t num) {
  JsonSockEvent *json = sockEmit.beginEmit("fwStatus");
  json->beginObject();
  json->addElem("available", this->updateAvailable);
  json->addElem("status", this->status);
  json->addElem("error", (int32_t)this->error);
  json->addElem("cancelled", this->cancelled);
  json->addElem("checkForUpdate", settings.checkForUpdate);
  json->addElem("inetAvailable", this->inetAvailable);
  json->beginObject("fwVersion");
  settings.fwVersion.toJSON(json);
  json->endObject();
  json->beginObject("appVersion");
  settings.appVersion.toJSON(json);
  json->endObject();
  json->beginObject("latest");
  this->latest.toJSON(json);
  json->endObject();
  json->endObject();
  sockEmit.endEmit(num);
}
int GitUpdater::checkInternet() {
  int err = 500;
  uint32_t t = millis();
  WiFiClientSecure sclient;
  sclient.setInsecure();
  sclient.setHandshakeTimeout(3);
  esp_task_wdt_reset();
  HTTPClient https;
  https.setReuse(false);
  if(https.begin(sclient, "https://github.com/" GITHUB_OWNER_REPO)) {
    https.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    https.setTimeout(3000);
    esp_task_wdt_reset();
    int httpCode = https.sendRequest("HEAD");
    esp_task_wdt_reset();
    if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY || httpCode == HTTP_CODE_FOUND) {
      err = 0;
      Serial.printf("Internet is Available: %ldms\n", millis() - t);
      this->inetAvailable = true;
    }
    else {
      err = httpCode;
      Serial.printf("Internet is Unavailable: %d: %ldms\n", err, millis() - t);
      this->inetAvailable = false;
    }
    https.end();
    sclient.stop();
  }
  esp_task_wdt_reset();
  return err;
}
void GitUpdater::emitDownloadProgress(size_t total, size_t loaded, const char *evt) { this->emitDownloadProgress(255, total, loaded, evt); }
void GitUpdater::emitDownloadProgress(uint8_t num, size_t total, size_t loaded, const char *evt) {
  JsonSockEvent *json = sockEmit.beginEmit(evt);
  json->beginObject();
  json->addElem("ver", this->targetRelease);
  json->addElem("part", (int32_t)this->partition);
  json->addElem("file", this->currentFile);
  json->addElem("total", (uint32_t)total);
  json->addElem("loaded", (uint32_t)loaded);
  json->addElem("error", (uint32_t)this->error);
  json->endObject();
  sockEmit.endEmit(num);
  sockEmit.loop();
  webServer.loop();
}
void GitUpdater::setFirmwareFile() {
  esp_chip_info_t ci;
  esp_chip_info(&ci);

  switch(ci.model) {
    case esp_chip_model_t::CHIP_ESP32S3: {
      uint32_t flash_size = spi_flash_get_chip_size();

      if (flash_size >= 8 * 1024 * 1024) {
        strlcpy(this->currentFile, "SomfyController.ino.esp32s3_8mb.bin", sizeof(this->currentFile));
      } else {
        strlcpy(this->currentFile, "SomfyController.ino.esp32s3_4mb.bin", sizeof(this->currentFile));
      }
      break;
    }
    case esp_chip_model_t::CHIP_ESP32S2:
      strlcpy(this->currentFile, "SomfyController.ino.esp32s2.bin", sizeof(this->currentFile));
      break;
    case esp_chip_model_t::CHIP_ESP32C3:
      strlcpy(this->currentFile, "SomfyController.ino.esp32c3.bin", sizeof(this->currentFile));
      break;
    case esp_chip_model_t::CHIP_ESP32:
      if (psramFound()) {
        strlcpy(this->currentFile, "SomfyController.ino.esp32wrover.bin", sizeof(this->currentFile));
      } else {
        strlcpy(this->currentFile, "SomfyController.ino.esp32.bin", sizeof(this->currentFile));
      }
      break;
    default:
      strlcpy(this->currentFile, "SomfyController.ino.esp32.bin", sizeof(this->currentFile));
      break;
  }
}
void GitUpdater::setFirmwareAsset(const char *version) {
  char base[64];
  this->setFirmwareFile();
  strlcpy(base, this->currentFile, sizeof(base));
  gitBuildVersionedAsset(this->currentFile, sizeof(this->currentFile), base, version);
}
void GitUpdater::setFilesystemAsset(const char *version) {
  gitBuildVersionedAsset(
    this->currentFile, sizeof(this->currentFile),
    "SomfyController.littlefs.bin", version);
}
bool GitUpdater::beginUpdate(const char *version) {
  Serial.println("Begin update called...");
  sprintf(this->baseUrl, "https://github.com/" GITHUB_OWNER_REPO "/releases/download/%s/", version);

  strcpy(this->targetRelease, version);
  this->emitUpdateCheck();
  this->partition = U_FLASH;
  this->lockFS = this->cancelled = false;
  this->error = 0;
  webServer.pendingFwRollback = false;
  // Same as web Manual Update: RF ISR + MQTT must not run while flash is busy.
  somfy.transceiver.end();
  mqtt.end();

  // Prefer versioned asset names; fall back to legacy unversioned names.
  this->setFirmwareAsset(version);
  this->error = this->downloadFile();
  if(this->error == ERR_HTTP_NOT_FOUND) {
    Serial.println("Versioned firmware asset missing - trying legacy name");
    this->setFirmwareFile();
    this->error = this->downloadFile();
  }

  bool fwFlashed = (this->error == 0 && !this->cancelled);
  if(fwFlashed) {
    somfy.commit();
    // New FW is boot target after Update.end; roll back if FS stage fails.
    webServer.pendingFwRollback = true;

    this->partition = U_SPIFFS;
    this->lockFS = true;
    this->setFilesystemAsset(version);
    this->error = this->downloadFile();
    if(this->error == ERR_HTTP_NOT_FOUND) {
      Serial.println("Versioned LittleFS asset missing - trying legacy name");
      strlcpy(this->currentFile, "SomfyController.littlefs.bin", sizeof(this->currentFile));
      this->error = this->downloadFile();
    }
    this->lockFS = false;

    if(this->error == 0) {
      settings.fwVersion.parse(version);
      delay(100);
      Serial.println("Committing Configuration...");
      // FS image already remounted by validateFilesystem(); rewrite user data.
      if(!webServer.remountAndRestoreUserConfig()) {
        Serial.println("Filesystem update remount/restore failed - recovering shade data, not rebooting");
        webServer.recoverUserConfigAfterFsFailure();
        webServer.rollbackPendingFirmware();
        this->error = -20;
      } else {
        rebootDelay.reboot = true;
        rebootDelay.rebootTime = millis() + 2000;
      }
    }
    else {
      Serial.printf("Filesystem update failed (error %d) - restoring shade data and rolling back firmware boot\n", this->error);
      webServer.recoverUserConfigAfterFsFailure();
      webServer.rollbackPendingFirmware();
    }
  }

  this->status = GIT_UPDATE_COMPLETE;
  this->emitUpdateCheck();
  return true;
}
bool GitUpdater::recoverFilesystem() {
  sprintf(this->baseUrl, "https://github.com/" GITHUB_OWNER_REPO "/releases/download/%s/", settings.fwVersion.name);
  this->status = GIT_UPDATING;
  this->partition = U_SPIFFS;
  this->lockFS = true;
  this->setFilesystemAsset(settings.fwVersion.name);
  this->error = this->downloadFile();
  if(this->error == ERR_HTTP_NOT_FOUND) {
    strlcpy(this->currentFile, "SomfyController.littlefs.bin", sizeof(this->currentFile));
    this->error = this->downloadFile();
  }
  this->lockFS = false;
  if(this->error == 0) {
    delay(100);
    Serial.println("Committing Configuration...");
    if(!webServer.remountAndRestoreUserConfig()) {
      Serial.println("Filesystem recovery remount/restore failed - restoring shade data, not rebooting");
      webServer.recoverUserConfigAfterFsFailure();
      this->error = -20;
    } else {
      rebootDelay.reboot = true;
      rebootDelay.rebootTime = millis() + 2000;
    }
  }
  else {
    Serial.printf("Filesystem recovery failed (error %d) - restoring shade data, not rebooting\n", this->error);
    webServer.recoverUserConfigAfterFsFailure();
  }
  this->status = GIT_UPDATE_COMPLETE;
  return true;
}
bool GitUpdater::endUpdate() { return true; }
// Mounts the LittleFS partition just written by Update.write()/Update.end()
// and confirms it actually holds a usable web UI, rather than trusting the
// downloaded-byte-count check alone. A truncated or bit-corrupted stream can
// still land on the expected total size while producing an unmountable or
// empty filesystem (the "Corrupted dir pair" failure mode reported in
// https://github.com/rstrouse/ESPSomfy-RTS/issues/493 and /579). Returning
// false here means the caller must NOT reboot into this partition.
bool GitUpdater::validateFilesystem() {
  LittleFS.end();
  if(!LittleFS.begin(false)) {
    Serial.println("LittleFS validation: partition did not mount after update");
    return false;
  }
  bool ok = LittleFS.exists("/index.html");
  if(ok) {
    File f = LittleFS.open("/index.html", "r");
    ok = f && f.size() > 0;
    if(f) f.close();
  }
  if(!ok) Serial.println("LittleFS validation: mounted, but /index.html is missing or empty");
  return ok;
}
int8_t GitUpdater::downloadFile() {
  Serial.printf("Begin update %s\n", this->currentFile);
  WiFiClientSecure sclient;
  sclient.setInsecure();
  HTTPClient https;
  char url[196];
  sprintf(url, "%s%s", this->baseUrl, this->currentFile);
  Serial.println(url);
  esp_task_wdt_reset();
  if(!https.begin(sclient, url)) {
    Serial.println("HTTPS begin failed");
    return -41;
  }
  https.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  Serial.print("[HTTPS] GET...\n");
  int httpCode = https.GET();
  if(httpCode <= 0) {
    Serial.printf("Invalid HTTP Code: %d\n", httpCode);
    https.end();
    sclient.stop();
    return httpCode == 0 ? -40 : (int8_t)httpCode;
  }
  size_t len = https.getSize();
  size_t total = 0;
  uint8_t pct = 0;
  Serial.printf("[HTTPS] GET... code: %d - %d\n", httpCode, len);
  if(httpCode != HTTP_CODE_OK && httpCode != HTTP_CODE_MOVED_PERMANENTLY && httpCode != HTTP_CODE_FOUND) {
    Serial.printf("Invalid HTTP Code... %d\n", httpCode);
    https.end();
    sclient.stop();
    if(httpCode == HTTP_CODE_NOT_FOUND) return ERR_HTTP_NOT_FOUND;
    return (int8_t)((httpCode > 127) ? -(httpCode % 100) : httpCode);
  }
  WiFiClient *stream = https.getStreamPtr();
  if(this->partition == U_SPIFFS) LittleFS.end();
  if(!Update.begin(len, this->partition)) {
    Serial.println("Update Error detected!!!!!");
    int8_t err = -(Update.getError() + UPDATE_ERR_OFFSET);
    https.end();
    sclient.stop();
    return err;
  }
  uint8_t *buff = (uint8_t *)malloc(MAX_BUFF_SIZE);
  if(!buff) {
    Serial.println("Unable to allocate memory for update!!!");
    Update.abort();
    https.end();
    sclient.stop();
    return -45;
  }
  this->emitDownloadProgress(len, total);
  int timeouts = 0;
  while(https.connected() && (len > 0 || len == -1) && total < len) {
    size_t size = stream->available();
    esp_task_wdt_reset();
    if(size) {
      timeouts = 0;
      if(this->cancelled && !this->lockFS) {
        Update.abort();
        free(buff);
        https.end();
        sclient.stop();
        return -(Update.getError() + UPDATE_ERR_OFFSET);
      }
      int c = stream->readBytes(buff, ((size > MAX_BUFF_SIZE) ? MAX_BUFF_SIZE : size));
      total += c;
      if(Update.write(buff, c) != c) {
        Serial.printf("Upload of %s aborted invalid size %d\n", url, c);
        int8_t err = -(Update.getError() + UPDATE_ERR_OFFSET);
        Update.abort();
        free(buff);
        https.end();
        sclient.stop();
        return err;
      }
      uint8_t p = (uint8_t)floor(((float)total / (float)len) * 100.0f);
      if(p != pct) {
        pct = p;
        Serial.printf("LEN:%d TOTAL:%d %d%%\n", len, total, pct);
        this->emitDownloadProgress(len, total);
      }
      delay(1);
      if(total >= len) {
        if(!Update.end(true)) {
          Serial.println("Error downloading update...");
          int8_t err = -(Update.getError() + UPDATE_ERR_OFFSET);
          free(buff);
          https.end();
          sclient.stop();
          return err;
        }
        Serial.println("Update.end Called...");
        https.end();
        sclient.stop();
      }
    }
    else {
      timeouts++;
      if(timeouts >= 500) {
        Update.abort();
        free(buff);
        https.end();
        sclient.stop();
        Serial.println("Stream timeout!!!");
        return -43;
      }
      sockEmit.loop();
      webServer.loop();
      delay(100);
    }
  }
  free(buff);
  if(len > total) {
    Update.abort();
    Serial.println("Error downloading file!!!");
    return -42;
  }
  Serial.printf("Update %s complete\n", this->currentFile);
  // Byte count matching len does not guarantee the written data is
  // actually a valid filesystem -- a truncated/garbled stream can still
  // land on the expected total. Mount and sanity-check it before we
  // let the caller commit to rebooting into it.
  if(this->partition == U_SPIFFS && !this->validateFilesystem()) {
    Serial.println("LittleFS validation failed after update - refusing to commit");
    return ERR_FS_VALIDATION;
  }
  Serial.printf("End update %s\n", this->currentFile);
  esp_task_wdt_reset();
  return 0;
}
