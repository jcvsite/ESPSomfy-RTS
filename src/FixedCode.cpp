/**
 * FixedCode.cpp — Non-Somfy 433 fixed-code learn/TX (RF switches).
 */

#include <LittleFS.h>
#include <ELECHOUSE_CC1101_SRC_DRV.h>
#include <esp_task_wdt.h>
#include <ArduinoJson.h>
#include "FixedCode.h"
#include "Somfy.h"
#include "MQTT.h"
#include "Sockets.h"
#include "ConfigSettings.h"
#include "ConfigFile.h"
#include "GitOTA.h"
#include "Utils.h"
#include "NoLog.h"

extern SomfyShadeController somfy;
extern MQTTClass mqtt;
extern SocketEmitter sockEmit;
extern ConfigSettings settings;
extern GitUpdater git;

FixedCodeController fixedCodes;

void fixedCodeFormatPreview(const uint16_t *pulses, uint16_t count, char *out, size_t outLen) {
  if(!out || outLen < 8) return;
  out[0] = '\0';
  if(!pulses || count == 0) {
    strncpy(out, "-", outLen - 1);
    out[outLen - 1] = '\0';
    return;
  }
  size_t used = 0;
  uint8_t show = count > 12 ? 12 : (uint8_t)count;
  for(uint8_t i = 0; i < show; i++) {
    char part[12];
    snprintf(part, sizeof(part), "%s%u", i ? "," : "", pulses[i]);
    size_t plen = strlen(part);
    if(used + plen + 4 >= outLen) {
      strncat(out, "...", outLen - used - 1);
      return;
    }
    strcat(out, part);
    used += plen;
  }
  if(count > show && used + 4 < outLen) strcat(out, "...");
}

uint32_t fixedCodeFingerprint(const uint16_t *pulses, uint16_t count) {
  uint32_t h = 2166136261u;
  h ^= count;
  h *= 16777619u;
  for(uint16_t i = 0; i < count; i++) {
    h ^= pulses[i];
    h *= 16777619u;
  }
  return h;
}

uint16_t fixedCodeTrimToFrame(uint16_t *pulses, uint16_t count) {
  if(!pulses || count < FIXED_LEARN_MIN_PULSES) return count;
  // Prefer the first inter-repeat gap after we already have a few data edges
  // (index 0/1 may be a long sync pulse belonging to the frame).
  for(uint16_t i = 4; i < count; i++) {
    if(pulses[i] >= FIXED_LEARN_FRAME_GAP_US)
      return i;
  }
  // Buffer filled with repeats and no clear gap — keep a single-frame-sized prefix.
  if(count > FIXED_LEARN_IDEAL_MAX) return FIXED_LEARN_IDEAL_MAX;
  return count;
}

#define FIXED_CFG_PATH "/fixedcodes.cfg"
#define FIXED_CFG_VER 3

void FixedCodeSwitch::clear() {
  this->id = 0;
  memset(this->name, 0, sizeof(this->name));
  this->frequency = FIXED_DEFAULT_FREQ;
  this->repeats = FIXED_DEFAULT_REPEATS;
  this->state = false;
  this->singleButton = false;
  this->flipCommands = false;
  this->onCount = 0;
  this->offCount = 0;
  memset(this->onPulses, 0, sizeof(this->onPulses));
  memset(this->offPulses, 0, sizeof(this->offPulses));
  this->lastTxMs = 0;
  this->lastTxWantOn = -1;
}

bool FixedCodeSwitch::canTransmit(bool wantOn) const {
  if(this->lastTxMs == 0 || this->lastTxWantOn < 0) return true;
  const bool opposite = (this->lastTxWantOn != 0) != wantOn;
  const uint32_t minMs = opposite ? FIXED_TX_REVERSE_CMD_MIN_MS : FIXED_TX_CMD_MIN_MS;
  return (millis() - this->lastTxMs) >= minMs;
}

uint32_t FixedCodeSwitch::txRetryAfterMs(bool wantOn) const {
  if(this->canTransmit(wantOn)) return 0;
  const bool opposite = (this->lastTxWantOn != 0) != wantOn;
  const uint32_t minMs = opposite ? FIXED_TX_REVERSE_CMD_MIN_MS : FIXED_TX_CMD_MIN_MS;
  const uint32_t elapsed = millis() - this->lastTxMs;
  return (elapsed >= minMs) ? 0 : (minMs - elapsed);
}

void FixedCodeSwitch::fromJSON(JsonObject &obj) {
  if(obj.containsKey("name")) {
    const char *n = obj["name"];
    strncpy(this->name, n ? n : "", FIXED_NAME_LEN - 1);
    this->name[FIXED_NAME_LEN - 1] = '\0';
  }
  if(obj.containsKey("frequency")) this->frequency = obj["frequency"].as<float>();
  if(obj.containsKey("repeats")) {
    uint8_t r = obj["repeats"].as<uint8_t>();
    if(r < 1) r = 1;
    if(r > 20) r = 20;
    this->repeats = r;
  }
  if(obj.containsKey("singleButton")) this->singleButton = obj["singleButton"].as<bool>();
  if(obj.containsKey("flipCommands")) this->flipCommands = obj["flipCommands"].as<bool>();
}

void FixedCodeSwitch::toJSON(JsonResponse &json) {
  json.addElem("id", this->id);
  json.addElem("name", this->name);
  json.addElem("frequency", this->frequency);
  json.addElem("repeats", this->repeats);
  json.addElem("state", this->state);
  json.addElem("singleButton", this->singleButton);
  json.addElem("flipCommands", this->flipCommands);
  json.addElem("onCount", (uint32_t)this->onCount);
  json.addElem("offCount", (uint32_t)this->offCount);
  json.addElem("hasOn", this->hasOn());
  json.addElem("hasOff", this->hasOff());
  json.addElem("ready", this->ready());
  char preview[96];
  fixedCodeFormatPreview(this->onPulses, this->onCount, preview, sizeof(preview));
  json.addElem("onPreview", preview);
  snprintf(preview, sizeof(preview), "%08X", (unsigned)fixedCodeFingerprint(this->onPulses, this->onCount));
  json.addElem("onCode", this->hasOn() ? preview : "");
  fixedCodeFormatPreview(this->offPulses, this->offCount, preview, sizeof(preview));
  json.addElem("offPreview", preview);
  snprintf(preview, sizeof(preview), "%08X", (unsigned)fixedCodeFingerprint(this->offPulses, this->offCount));
  json.addElem("offCode", this->hasOff() ? preview : "");
}

void FixedCodeController::toJSON(JsonResponse &json) {
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) {
    if(this->switches[i].id != 0) {
      json.beginObject();
      this->switches[i].toJSON(json);
      json.endObject();
    }
  }
}

void FixedCodeSwitch::emitState(uint8_t num) {
  JsonSockEvent *json = sockEmit.beginEmit("fixedCodeState");
  json->beginObject();
  json->addElem("id", this->id);
  json->addElem("name", this->name);
  json->addElem("frequency", this->frequency);
  json->addElem("repeats", this->repeats);
  json->addElem("state", this->state);
  json->addElem("singleButton", this->singleButton);
  json->addElem("flipCommands", this->flipCommands);
  json->addElem("onCount", (uint32_t)this->onCount);
  json->addElem("offCount", (uint32_t)this->offCount);
  json->addElem("hasOn", this->hasOn());
  json->addElem("hasOff", this->hasOff());
  json->addElem("ready", this->ready());
  char preview[96];
  fixedCodeFormatPreview(this->onPulses, this->onCount, preview, sizeof(preview));
  json->addElem("onPreview", preview);
  snprintf(preview, sizeof(preview), "%08X", (unsigned)fixedCodeFingerprint(this->onPulses, this->onCount));
  json->addElem("onCode", this->hasOn() ? preview : "");
  fixedCodeFormatPreview(this->offPulses, this->offCount, preview, sizeof(preview));
  json->addElem("offPreview", preview);
  snprintf(preview, sizeof(preview), "%08X", (unsigned)fixedCodeFingerprint(this->offPulses, this->offCount));
  json->addElem("offCode", this->hasOff() ? preview : "");
  json->endObject();
  sockEmit.endEmit(num);
}

void FixedCodeSwitch::publish() {
  if(!mqtt.connected() || this->id == 0) return;
  char topic[64];
  snprintf(topic, sizeof(topic), "switches/%u/name", this->id);
  mqtt.publish(topic, this->name, true);
  snprintf(topic, sizeof(topic), "switches/%u/state", this->id);
  mqtt.publish(topic, this->state ? "ON" : "OFF", true);
  snprintf(topic, sizeof(topic), "switches/%u/frequency", this->id);
  char freq[16];
  dtostrf(this->frequency, 0, 2, freq);
  mqtt.publish(topic, freq, true);
  this->publishDisco();
}

void FixedCodeSwitch::unpublish() {
  if(!mqtt.connected() || this->id == 0) return;
  char topic[64];
  snprintf(topic, sizeof(topic), "switches/%u/name", this->id);
  mqtt.unpublish(topic);
  snprintf(topic, sizeof(topic), "switches/%u/state", this->id);
  mqtt.unpublish(topic);
  snprintf(topic, sizeof(topic), "switches/%u/frequency", this->id);
  mqtt.unpublish(topic);
  this->unpublishDisco();
}

void FixedCodeSwitch::publishDisco() {
  if(!mqtt.connected() || !settings.MQTT.pubDisco || this->id == 0) return;
  char topic[128] = "";
  DynamicJsonDocument doc(1024);
  JsonObject obj = doc.to<JsonObject>();
  snprintf(topic, sizeof(topic), "%s/switches/%u", settings.MQTT.rootTopic, this->id);
  obj["~"] = topic;
  JsonObject dobj = obj.createNestedObject("device");
  dobj["hw_version"] = settings.fwVersion.name;
  dobj["name"] = settings.hostname;
  dobj["mf"] = "ESPSomfy";
  JsonArray arrids = dobj.createNestedArray("identifiers");
  snprintf(topic, sizeof(topic), "mqtt_espsomfyrts_%s", settings.serverId);
  arrids.add(topic);
  dobj["via_device"] = topic;
  dobj["model"] = "ESPSomfy-RTS MQTT";
  snprintf(topic, sizeof(topic), "%s/status", settings.MQTT.rootTopic);
  obj["availability_topic"] = topic;
  obj["payload_available"] = "online";
  obj["payload_not_available"] = "offline";
  obj["name"] = this->name;
  snprintf(topic, sizeof(topic), "mqtt_%s_fc%u", settings.serverId, this->id);
  obj["unique_id"] = topic;
  obj["payload_on"] = "ON";
  obj["payload_off"] = "OFF";
  obj["state_on"] = "ON";
  obj["state_off"] = "OFF";
  obj["state_topic"] = "~/state";
  obj["command_topic"] = "~/state/set";
  obj["enabled_by_default"] = true;
  snprintf(topic, sizeof(topic), "%s/switch/fc%u/config", settings.MQTT.discoTopic, this->id);
  mqtt.publishDisco(topic, obj, true);
}

void FixedCodeSwitch::unpublishDisco() {
  if(!mqtt.connected() || !settings.MQTT.pubDisco || this->id == 0) return;
  char topic[128];
  snprintf(topic, sizeof(topic), "%s/switch/fc%u/config", settings.MQTT.discoTopic, this->id);
  mqtt.unpublish(topic);
}

bool FixedCodeSwitch::setState(bool on, bool transmit) {
  if(transmit) {
    // Logical ON/OFF follows the request; flipCommands only swaps RF pulse bank.
    bool txOn = this->flipCommands ? !on : on;
    // Single-button remotes reuse the same code for ON and OFF (device toggles)
    bool useOn = this->singleButton || txOn || !this->hasOff();
    const uint16_t *pulses = useOn ? this->onPulses : this->offPulses;
    uint16_t count = useOn ? this->onCount : this->offCount;
    if(count < FIXED_LEARN_MIN_PULSES) {
      // Fallback to the other learned code if present
      pulses = this->hasOn() ? this->onPulses : this->offPulses;
      count = this->hasOn() ? this->onCount : this->offCount;
    }
    if(count < FIXED_LEARN_MIN_PULSES) return false;
    if(!somfy.transceiver.config.enabled) return false;
    float restore = somfy.transceiver.config.frequency;
    ELECHOUSE_cc1101.setMHZ(this->frequency);
    somfy.transceiver.beginTransmit();
    for(uint8_t r = 0; r < this->repeats; r++) {
      somfy.transceiver.sendPulses(pulses, count);
      if(r + 1 < this->repeats) delayMicroseconds(FIXED_INTER_REPEAT_US);
    }
    somfy.transceiver.endTransmit();
    ELECHOUSE_cc1101.setMHZ(restore);
    this->lastTxMs = millis();
    this->lastTxWantOn = on ? 1 : 0;
  }
  this->state = on;
  this->emitState();
  if(mqtt.connected()) {
    char topic[64];
    snprintf(topic, sizeof(topic), "switches/%u/state", this->id);
    mqtt.publish(topic, this->state ? "ON" : "OFF", true);
  }
  return true;
}

void FixedCodeController::begin() {
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) this->switches[i].clear();
  this->load();
}

void FixedCodeController::loop() {
  if(this->isLearning()) {
    if(millis() - this->learnStarted > FIXED_LEARN_TIMEOUT_MS) {
      this->endLearn(true);
    }
    else {
      somfy.transceiver.processFixedCodeLearn();
      static uint32_t lastProg = 0;
      if(millis() - lastProg > 250) {
        lastProg = millis();
        this->emitLearnProgress();
      }
    }
  }
  if(this->isDirty && millis() - this->lastCommit > 1000) {
    this->commit();
  }
}

void FixedCodeController::commit() {
  if(git.lockFS) return;
  esp_task_wdt_reset();
  this->save();
  this->isDirty = false;
  this->lastCommit = millis();
}

static void writePulseList(File &f, const uint16_t *pulses, uint16_t count) {
  f.print(count);
  for(uint16_t i = 0; i < count; i++) {
    f.print(',');
    f.print(pulses[i]);
  }
}

void FixedCodeController::save() {
  if(git.lockFS) return;
  File f = LittleFS.open(FIXED_CFG_PATH, "w");
  if(!f) return;
  f.printf("%u,%u\n", FIXED_CFG_VER, this->count());
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) {
    FixedCodeSwitch *sw = &this->switches[i];
    if(sw->id == 0) continue;
    // Escape commas in name by replacing with space for simplicity
    char safeName[FIXED_NAME_LEN];
    strncpy(safeName, sw->name, FIXED_NAME_LEN - 1);
    safeName[FIXED_NAME_LEN - 1] = '\0';
    for(char *p = safeName; *p; p++) if(*p == ',' || *p == '\n') *p = ' ';
    f.printf("%u,%s,%.2f,%u,%u,%u,%u,", sw->id, safeName, sw->frequency, sw->repeats, sw->state ? 1 : 0,
      sw->singleButton ? 1 : 0, sw->flipCommands ? 1 : 0);
    writePulseList(f, sw->onPulses, sw->onCount);
    f.print(',');
    writePulseList(f, sw->offPulses, sw->offCount);
    f.print('\n');
  }
  f.close();
}

void FixedCodeController::load() {
  if(!LittleFS.exists(FIXED_CFG_PATH)) return;
  File f = LittleFS.open(FIXED_CFG_PATH, "r");
  if(!f) return;
  String header = f.readStringUntil('\n');
  uint8_t ver = 1;
  if(header.length() > 0) ver = (uint8_t)atoi(header.c_str());
  int slot = 0;
  while(f.available() && slot < FIXED_MAX_SWITCHES) {
    String line = f.readStringUntil('\n');
    if(line.length() < 5) continue;
    char buf[1024];
    if(line.length() >= sizeof(buf)) continue;
    strcpy(buf, line.c_str());
    char *toks[FIXED_MAX_PULSES * 2 + 16];
    uint16_t ntok = 0;
    char *p = buf;
    while(p && *p && ntok < (sizeof(toks) / sizeof(toks[0]))) {
      toks[ntok++] = p;
      char *c = strchr(p, ',');
      if(!c) break;
      *c = '\0';
      p = c + 1;
    }
    if(ntok < 7) continue;
    FixedCodeSwitch *sw = &this->switches[slot++];
    sw->clear();
    sw->id = (uint8_t)atoi(toks[0]);
    strncpy(sw->name, toks[1], FIXED_NAME_LEN - 1);
    sw->frequency = atof(toks[2]);
    sw->repeats = (uint8_t)atoi(toks[3]);
    sw->state = atoi(toks[4]) != 0;
    uint16_t idx = 5;
    if(ver >= 2 && idx < ntok) {
      sw->singleButton = atoi(toks[idx++]) != 0;
    }
    if(ver >= 3 && idx < ntok) {
      sw->flipCommands = atoi(toks[idx++]) != 0;
    }
    if(idx >= ntok) continue;
    uint16_t onCount = (uint16_t)atoi(toks[idx++]);
    sw->onCount = 0;
    for(uint16_t i = 0; i < onCount && idx < ntok && sw->onCount < FIXED_MAX_PULSES; i++, idx++) {
      sw->onPulses[sw->onCount++] = (uint16_t)atoi(toks[idx]);
    }
    if(idx >= ntok) continue;
    uint16_t offCount = (uint16_t)atoi(toks[idx++]);
    sw->offCount = 0;
    for(uint16_t i = 0; i < offCount && idx < ntok && sw->offCount < FIXED_MAX_PULSES; i++, idx++) {
      sw->offPulses[sw->offCount++] = (uint16_t)atoi(toks[idx]);
    }
  }
  f.close();
}

void FixedCodeController::writeBackup() {
  // Embedded into controller.backup by SomfyShadeController::writeBackup
}

bool FixedCodeController::appendToBackup(File &dst) {
  if(!LittleFS.exists(FIXED_CFG_PATH)) {
    dst.print("\n###FIXEDCODES###\n");
    dst.printf("%u,0\n", FIXED_CFG_VER);
    return true;
  }
  return backupAppendSection(dst, "FIXEDCODES", FIXED_CFG_PATH);
}

bool FixedCodeController::extractFromRestoreFile(const char *path) {
  if(!backupExtractSection(path, "FIXEDCODES", FIXED_CFG_PATH)) return false;
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) this->switches[i].clear();
  this->load();
  return true;
}

bool FixedCodeController::restoreFromBackup() {
  return this->extractFromRestoreFile("/shades.tmp") || this->extractFromRestoreFile("/fixedcodes.backup");
}

uint8_t FixedCodeController::count() const {
  uint8_t n = 0;
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) if(this->switches[i].id != 0) n++;
  return n;
}

uint8_t FixedCodeController::getNextId() {
  for(uint8_t id = 1; id <= FIXED_MAX_SWITCHES; id++) {
    if(!this->getById(id)) return id;
  }
  return 0;
}

FixedCodeSwitch *FixedCodeController::getById(uint8_t id) {
  if(id == 0) return nullptr;
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) {
    if(this->switches[i].id == id) return &this->switches[i];
  }
  return nullptr;
}

FixedCodeSwitch *FixedCodeController::add(JsonObject &obj) {
  if(this->count() >= FIXED_MAX_SWITCHES) return nullptr;
  uint8_t id = this->getNextId();
  if(id == 0) return nullptr;
  FixedCodeSwitch *slot = nullptr;
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) {
    if(this->switches[i].id == 0) { slot = &this->switches[i]; break; }
  }
  if(!slot) return nullptr;
  slot->clear();
  slot->id = id;
  snprintf(slot->name, FIXED_NAME_LEN, "RF Switch %u", id);
  slot->fromJSON(obj);
  this->isDirty = true;
  slot->emitState();
  slot->publish();
  return slot;
}

bool FixedCodeController::saveSwitch(JsonObject &obj) {
  if(!obj.containsKey("id")) return false;
  FixedCodeSwitch *sw = this->getById(obj["id"].as<uint8_t>());
  if(!sw) return false;
  sw->fromJSON(obj);
  if(sw->singleButton && sw->hasOn()) {
    sw->offCount = sw->onCount;
    memcpy(sw->offPulses, sw->onPulses, sw->onCount * sizeof(uint16_t));
  }
  this->isDirty = true;
  sw->emitState();
  sw->publish();
  return true;
}

bool FixedCodeController::remove(uint8_t id) {
  FixedCodeSwitch *sw = this->getById(id);
  if(!sw) return false;
  if(this->learnId == id) this->endLearn(true);
  sw->unpublish();
  sw->clear();
  this->isDirty = true;
  JsonSockEvent *json = sockEmit.beginEmit("fixedCodeRemoved");
  json->beginObject();
  json->addElem("id", id);
  json->endObject();
  sockEmit.endEmit();
  this->publish();
  return true;
}

fixed_cmd_result FixedCodeController::command(uint8_t id, const char *state, uint32_t *retryAfterMs) {
  if(retryAfterMs) *retryAfterMs = 0;
  FixedCodeSwitch *sw = this->getById(id);
  if(!sw || !state) return fixed_cmd_result::error;
  bool on;
  if(strcasecmp(state, "toggle") == 0) on = !sw->state;
  else if(strcasecmp(state, "on") == 0 || strcmp(state, "1") == 0 || strcasecmp(state, "true") == 0) on = true;
  else if(strcasecmp(state, "off") == 0 || strcmp(state, "0") == 0 || strcasecmp(state, "false") == 0) on = false;
  else return fixed_cmd_result::error;
  if(!sw->canTransmit(on)) {
    if(retryAfterMs) *retryAfterMs = sw->txRetryAfterMs(on);
    Serial.printf("RATE LIMIT: ignored fixedCode id=%u state=%s\n", id, state);
    return fixed_cmd_result::rate_limited;
  }
  if(!sw->setState(on, true)) return fixed_cmd_result::error;
  return fixed_cmd_result::ok;
}

bool FixedCodeController::isLearning() const {
  return this->learnBtn != fixed_learn_btn::none && this->learnId != 0;
}

bool FixedCodeController::beginLearn(uint8_t id, fixed_learn_btn btn) {
  FixedCodeSwitch *sw = this->getById(id);
  if(!sw || btn == fixed_learn_btn::none) return false;
  if(!somfy.transceiver.config.enabled) return false;
  if(this->isLearning()) this->endLearn(true);
  this->learnId = id;
  this->learnBtn = btn;
  this->learnStarted = millis();
  somfy.transceiver.beginFixedCodeLearn(sw->frequency);
  JsonSockEvent *json = sockEmit.beginEmit("fixedCodeLearn");
  json->beginObject();
  json->addElem("id", id);
  json->addElem("button", btn == fixed_learn_btn::on ? "on" : "off");
  json->addElem("learning", true);
  json->addElem("success", false);
  json->addElem("pulseCount", (uint32_t)0);
  json->endObject();
  sockEmit.endEmit();
  return true;
}

void FixedCodeController::endLearn(bool cancel) {
  if(!this->isLearning() && !somfy.transceiver.isFixedCodeLearning()) {
    somfy.transceiver.endFixedCodeLearn();
    return;
  }
  uint8_t id = this->learnId;
  const char *btn = this->learnBtn == fixed_learn_btn::on ? "on" : "off";
  this->learnId = 0;
  this->learnBtn = fixed_learn_btn::none;
  somfy.transceiver.endFixedCodeLearn();
  JsonSockEvent *json = sockEmit.beginEmit("fixedCodeLearn");
  json->beginObject();
  json->addElem("id", id);
  json->addElem("button", btn);
  json->addElem("learning", false);
  json->addElem("success", false);
  json->addElem("cancelled", cancel);
  json->addElem("pulseCount", (uint32_t)0);
  json->endObject();
  sockEmit.endEmit();
}

void FixedCodeController::onLearnComplete(const uint16_t *pulses, uint16_t count) {
  FixedCodeSwitch *sw = this->getById(this->learnId);
  fixed_learn_btn btn = this->learnBtn;
  uint8_t id = this->learnId;
  this->learnId = 0;
  this->learnBtn = fixed_learn_btn::none;
  int16_t peakRssi = somfy.transceiver.fixedCodeLearnPeakRssi();
  somfy.transceiver.endFixedCodeLearn();

  uint16_t buf[FIXED_MAX_PULSES];
  uint16_t n = count > FIXED_MAX_PULSES ? FIXED_MAX_PULSES : count;
  if(pulses && n) memcpy(buf, pulses, n * sizeof(uint16_t));
  n = fixedCodeTrimToFrame(buf, n);
  count = n;
  pulses = buf;

  uint16_t typical = 0;
  uint16_t shortEdges = 0;
  for(uint16_t i = 0; i < count; i++) {
    if(pulses[i] < 100) shortEdges++;
    // Pool / gate remotes often use longer sync pulses than Somfy-like remotes.
    if(pulses[i] >= 150 && pulses[i] <= 16000) typical++;
  }
  // Reject empty/noise captures; keep gates loose enough for EV1527-style pool remotes.
  bool lookValid = count >= FIXED_LEARN_MIN_PULSES
    && count <= FIXED_LEARN_MAX_ACCEPT
    && peakRssi >= FIXED_LEARN_MIN_RSSI
    && shortEdges < ((count * 3) / 4)
    && typical >= (count / 8);

  bool ok = sw && lookValid && btn != fixed_learn_btn::none;
  char preview[96] = "";
  char code[12] = "";
  const char *reason = "";
  if(!ok) {
    if(count < FIXED_LEARN_MIN_PULSES) reason = "too_few_pulses";
    else if(count > FIXED_LEARN_MAX_ACCEPT) reason = "too_many_pulses";
    else if(peakRssi < FIXED_LEARN_MIN_RSSI) reason = "weak_rssi";
    else if(shortEdges >= ((count * 3) / 4)) reason = "noisy";
    else if(typical < (count / 8)) reason = "bad_timing";
    else reason = "noise_or_weak";
  }
  if(ok) {
    // Always store on the requested button slot
    if(btn == fixed_learn_btn::on || sw->singleButton) {
      sw->onCount = count;
      memcpy(sw->onPulses, pulses, sw->onCount * sizeof(uint16_t));
    }
    if(btn == fixed_learn_btn::off && !sw->singleButton) {
      sw->offCount = count;
      memcpy(sw->offPulses, pulses, sw->offCount * sizeof(uint16_t));
    }
    // Single-button toggle: same RF code for ON and OFF
    if(sw->singleButton) {
      sw->offCount = sw->onCount;
      memcpy(sw->offPulses, sw->onPulses, sw->onCount * sizeof(uint16_t));
    }
    this->isDirty = true;
    sw->emitState();
    fixedCodeFormatPreview(pulses, count, preview, sizeof(preview));
    snprintf(code, sizeof(code), "%08X", (unsigned)fixedCodeFingerprint(pulses, count));
  }
  JsonSockEvent *json = sockEmit.beginEmit("fixedCodeLearn");
  json->beginObject();
  json->addElem("id", id);
  json->addElem("button", btn == fixed_learn_btn::on ? "on" : "off");
  json->addElem("learning", false);
  json->addElem("success", ok);
  json->addElem("pulseCount", (uint32_t)count);
  json->addElem("rssi", (int32_t)peakRssi);
  json->addElem("preview", preview);
  json->addElem("code", code);
  if(!ok) json->addElem("reason", reason);
  json->endObject();
  sockEmit.endEmit();
}

void FixedCodeController::emitLearnProgress() {
  if(!this->isLearning()) return;
  JsonSockEvent *json = sockEmit.beginEmit("fixedCodeLearn");
  json->beginObject();
  json->addElem("id", this->learnId);
  json->addElem("button", this->learnBtn == fixed_learn_btn::on ? "on" : "off");
  json->addElem("learning", true);
  json->addElem("success", false);
  json->addElem("pulseCount", (uint32_t)somfy.transceiver.fixedCodeLearnPulseCount());
  json->addElem("rssi", (int32_t)somfy.transceiver.fixedCodeLearnRssi());
  json->addElem("listening", true);
  json->endObject();
  sockEmit.endEmit();
}

void FixedCodeController::publish() {
  if(!mqtt.connected()) return;
  char arrIds[64] = "[";
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) {
    FixedCodeSwitch *sw = &this->switches[i];
    if(sw->id == 0) continue;
    if(strlen(arrIds) > 1) strcat(arrIds, ",");
    itoa(sw->id, &arrIds[strlen(arrIds)], 10);
    sw->publish();
  }
  strcat(arrIds, "]");
  mqtt.publish("switches", arrIds, true);
  for(uint8_t id = 1; id <= FIXED_MAX_SWITCHES; id++) {
    if(!this->getById(id)) {
      char topic[64];
      snprintf(topic, sizeof(topic), "switches/%u/name", id);
      mqtt.unpublish(topic);
      snprintf(topic, sizeof(topic), "switches/%u/state", id);
      mqtt.unpublish(topic);
      snprintf(topic, sizeof(topic), "switches/%u/frequency", id);
      mqtt.unpublish(topic);
      snprintf(topic, sizeof(topic), "%s/switch/fc%u/config", settings.MQTT.discoTopic, id);
      if(settings.MQTT.pubDisco) mqtt.unpublish(topic);
    }
  }
}

void FixedCodeController::emitAll(uint8_t num) {
  for(uint8_t i = 0; i < FIXED_MAX_SWITCHES; i++) {
    if(this->switches[i].id != 0) this->switches[i].emitState(num);
  }
}
