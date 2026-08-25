/**
 * Automation.cpp — Scenes and NTP schedules; RF command queue for room/scene actions.
 */

#include <LittleFS.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include <time.h>
#include "Automation.h"
#include "ConfigFile.h"
#include "Somfy.h"
#include "Mesh.h"
#include "GitOTA.h"
#include "NoLog.h"

extern SomfyShadeController somfy;
extern MeshController mesh;
extern GitUpdater git;

AutomationController *automation;
static char autoJson[12288];

#define AUTO_QMS 200
#define AUTO_SCENES_PATH "/scenes.cfg"
#define AUTO_SCHED_PATH "/schedules.cfg"

static bool skipShade(SomfyShade *s) {
  if(!s || s->getShadeId() == 255) return true;
  shade_types t = s->shadeType;
  return t == shade_types::drycontact || t == shade_types::drycontact2;
}

void AutomationController::clearAll() {
  memset(scenes, 0, sizeof(scenes));
  memset(schedules, 0, sizeof(schedules));
  memset(qKind, 0, sizeof(qKind));
  memset(qId, 0, sizeof(qId));
  memset(qA, 0, sizeof(qA));
  memset(qB, 0, sizeof(qB));
  qn = 0;
  qh = 0;
  lastQms = 0;
  lastSchedMin = -1;
}

bool AutomationController::begin() {
  clearAll();
  load();
  return true;
}

scene_t *AutomationController::sceneById(uint8_t id) {
  if(!id) return nullptr;
  for(uint8_t i = 0; i < AUTO_MAX_SCENES; i++)
    if(scenes[i].id == id) return &scenes[i];
  return nullptr;
}

scene_t *AutomationController::emptyScene() {
  for(uint8_t i = 0; i < AUTO_MAX_SCENES; i++)
    if(scenes[i].id == 0) return &scenes[i];
  return nullptr;
}

void AutomationController::enqueue(uint8_t kind, uint8_t id, uint8_t a, int8_t b) {
  if(qn >= AUTO_QMAX) return;
  uint8_t i = (qh + qn) % AUTO_QMAX;
  qKind[i] = kind;
  qId[i] = id;
  qA[i] = a;
  qB[i] = b;
  qn++;
  if(qn == 1) lastQms = 0;
}

void AutomationController::pumpQueue() {
  if(!qn) return;
  if(lastQms && (millis() - lastQms) < AUTO_QMS) return;
  uint8_t kind = qKind[qh];
  uint8_t id = qId[qh];
  uint8_t a = qA[qh];
  int8_t b = qB[qh];
  qh = (qh + 1) % AUTO_QMAX;
  qn--;
  lastQms = millis();
  SomfyShade *s = somfy.getShadeById(id);
  if(!s || skipShade(s)) return;
  if(kind == 1) {
    float tilt = b < 0 ? -1.0f : s->transformPosition((float)b);
    s->moveToTarget(s->transformPosition((float)a), tilt);
  } else {
    s->sendCommand(static_cast<somfy_commands>(a));
  }
}

bool AutomationController::roomCommand(uint8_t roomId, const char *cmd) {
  if(!cmd || !cmd[0]) return false;
  char cbuf[12];
  strlcpy(cbuf, cmd, sizeof(cbuf));
  if(!strcasecmp(cbuf, "open")) strcpy(cbuf, "up");
  else if(!strcasecmp(cbuf, "close")) strcpy(cbuf, "down");
  somfy_commands c = translateSomfyCommand(String(cbuf));
  uint8_t n = 0;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES; i++) {
    SomfyShade *s = &somfy.shades[i];
    if(skipShade(s)) continue;
    if(roomId && s->roomId != roomId) continue;
    enqueue(0, s->getShadeId(), (uint8_t)c, 0);
    n++;
  }
  return n > 0;
}

bool AutomationController::applyScene(uint8_t id) {
  scene_t *sc = sceneById(id);
  if(!sc) return false;
  uint8_t n = 0;
  for(uint8_t i = 0; i < sc->nsteps; i++) {
    scene_step_t &st = sc->steps[i];
    if(!st.shadeId) continue;
    uint8_t before = qn;
    enqueue(1, st.shadeId, (uint8_t)st.pos, st.tilt);
    if(qn > before) n++;
  }
  return n > 0;
}

void AutomationController::checkSchedules() {
  struct tm dt;
  if(!getLocalTime(&dt, 10)) return;
  int nowMin = dt.tm_hour * 60 + dt.tm_min;
  if(lastSchedMin < 0) { lastSchedMin = nowMin; return; }
  if(nowMin == lastSchedMin) return;
  lastSchedMin = nowMin;
  uint8_t dayBit = (uint8_t)(1 << dt.tm_wday);
  for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++) {
    schedule_t &t = schedules[i];
    if(!t.id || !t.enabled) continue;
    if(t.hour != (uint8_t)dt.tm_hour || t.minute != (uint8_t)dt.tm_min) continue;
    if(t.days && !(t.days & dayBit)) continue;
    if(t.kind == 1) applyScene(t.target);
    else {
      const char *cmd = "my";
      if(t.cmd == 0) cmd = "up";
      else if(t.cmd == 2) cmd = "down";
      else if(t.cmd == 3) cmd = "stop";
      roomCommand(t.target, cmd);
    }
  }
}

void AutomationController::loop() {
  if(git.lockFS) return;
  pumpQueue();
  static uint32_t lastChk = 0;
  if(millis() - lastChk < 1000) return;
  lastChk = millis();
  checkSchedules();
}

bool AutomationController::save() {
  if(git.lockFS) return false;
  {
    File f = LittleFS.open("/scenes.tmp", "w");
    if(!f) return false;
    for(uint8_t i = 0; i < AUTO_MAX_SCENES; i++) {
      scene_t &sc = scenes[i];
      if(!sc.id) continue;
      f.printf("S|%u|%u|%s\n", sc.id, sc.roomId, sc.name);
      for(uint8_t k = 0; k < sc.nsteps; k++)
        f.printf("s|%u|%d|%d\n", sc.steps[k].shadeId, (int)sc.steps[k].pos, (int)sc.steps[k].tilt);
    }
    f.close();
    LittleFS.remove(AUTO_SCENES_PATH);
    LittleFS.rename("/scenes.tmp", AUTO_SCENES_PATH);
  }
  {
    File f = LittleFS.open("/schedules.tmp", "w");
    if(!f) return false;
    for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++) {
      schedule_t &t = schedules[i];
      if(!t.id) continue;
      f.printf("T|%u|%u|%u|%u|%u|%u|%u|%u\n",
        t.id, t.enabled, t.hour, t.minute, t.days, t.kind, t.target, t.cmd);
    }
    f.close();
    LittleFS.remove(AUTO_SCHED_PATH);
    LittleFS.rename("/schedules.tmp", AUTO_SCHED_PATH);
  }
  return true;
}

bool AutomationController::load() {
  File f = LittleFS.open(AUTO_SCENES_PATH, "r");
  if(f) {
    scene_t *cur = nullptr;
    while(f.available()) {
      String line = f.readStringUntil('\n');
      line.trim();
      if(line.startsWith("S|")) {
        uint8_t id = 0, roomId = 0;
        char name[AUTO_NAME_LEN];
        name[0] = 0;
        if(sscanf(line.c_str(), "S|%hhu|%hhu|%23[^\n]", &id, &roomId, name) < 2) continue;
        cur = emptyScene();
        if(!cur) break;
        cur->id = id ? id : 1;
        cur->roomId = roomId;
        strlcpy(cur->name, name, AUTO_NAME_LEN);
        cur->nsteps = 0;
      } else if(line.startsWith("s|") && cur && cur->nsteps < AUTO_SCENE_STEPS) {
        unsigned sid = 0;
        int pos = 0, tilt = -1;
        if(sscanf(line.c_str(), "s|%u|%d|%d", &sid, &pos, &tilt) < 2) continue;
        scene_step_t &st = cur->steps[cur->nsteps++];
        st.shadeId = (uint8_t)sid;
        st.pos = pos < 0 ? 0 : (pos > 100 ? 100 : (int8_t)pos);
        st.tilt = tilt < -1 ? -1 : (tilt > 100 ? 100 : (int8_t)tilt);
      }
    }
    f.close();
  }
  f = LittleFS.open(AUTO_SCHED_PATH, "r");
  if(f) {
    uint8_t n = 0;
    while(f.available() && n < AUTO_MAX_SCHEDULES) {
      String line = f.readStringUntil('\n');
      line.trim();
      if(!line.startsWith("T|")) continue;
      unsigned id = 0, en = 0, hour = 0, minute = 0, days = 0, kind = 0, target = 0, cmd = 0;
      if(sscanf(line.c_str(), "T|%u|%u|%u|%u|%u|%u|%u|%u",
          &id, &en, &hour, &minute, &days, &kind, &target, &cmd) < 8) continue;
      schedule_t &t = schedules[n++];
      t.id = (uint8_t)id;
      t.enabled = en ? 1 : 0;
      t.hour = hour > 23 ? 23 : (uint8_t)hour;
      t.minute = minute > 59 ? 59 : (uint8_t)minute;
      t.days = (uint8_t)days;
      t.kind = kind ? 1 : 0;
      t.target = (uint8_t)target;
      t.cmd = cmd > 3 ? 1 : (uint8_t)cmd;
    }
    f.close();
  }
  return true;
}

bool AutomationController::appendToBackup(File &dst) {
  bool ok = backupAppendSection(dst, "SCENES", AUTO_SCENES_PATH);
  ok = backupAppendSection(dst, "SCHEDULES", AUTO_SCHED_PATH) && ok;
  return ok;
}

bool AutomationController::restoreFromBackup() {
  bool gotScenes = backupExtractSection("/shades.tmp", "SCENES", AUTO_SCENES_PATH)
                || backupExtractSection("/automation.backup", "SCENES", AUTO_SCENES_PATH);
  bool gotSched = backupExtractSection("/shades.tmp", "SCHEDULES", AUTO_SCHED_PATH)
               || backupExtractSection("/automation.backup", "SCHEDULES", AUTO_SCHED_PATH);
  if(!gotScenes && !gotSched) return false;
  clearAll();
  load();
  return true;
}

void AutomationController::toJSONScenes(JsonResponse &json) {
  for(uint8_t i = 0; i < AUTO_MAX_SCENES; i++) {
    scene_t &sc = scenes[i];
    if(!sc.id) continue;
    json.beginObject();
    json.addElem("id", sc.id);
    json.addElem("name", sc.name);
    json.addElem("roomId", sc.roomId);
    json.beginArray("steps");
    for(uint8_t k = 0; k < sc.nsteps; k++) {
      json.beginObject();
      json.addElem("shadeId", sc.steps[k].shadeId);
      json.addElem("pos", sc.steps[k].pos);
      json.addElem("tilt", sc.steps[k].tilt);
      json.endObject();
    }
    json.endArray();
    json.endObject();
  }
}

void AutomationController::toJSONSchedules(JsonResponse &json) {
  for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++) {
    schedule_t &t = schedules[i];
    if(!t.id) continue;
    json.beginObject();
    json.addElem("id", t.id);
    json.addElem("enabled", (bool)t.enabled);
    json.addElem("hour", t.hour);
    json.addElem("minute", t.minute);
    json.addElem("days", t.days);
    json.addElem("kind", t.kind);
    json.addElem("target", t.target);
    json.addElem("cmd", t.cmd);
    json.endObject();
  }
}

static void sendOk(WebServer &server, bool ok) {
  JsonResponse resp;
  resp.beginResponse(&server, autoJson, sizeof(autoJson));
  resp.beginObject();
  resp.addElem("ok", ok);
  resp.endObject();
  resp.endResponse();
}

bool AutomationController::deleteScene(uint8_t id) {
  scene_t *sc = sceneById(id);
  if(!sc) return false;
  memset(sc, 0, sizeof(*sc));
  return save();
}

bool AutomationController::deleteSchedule(uint8_t id) {
  for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++) {
    if(schedules[i].id == id) {
      memset(&schedules[i], 0, sizeof(schedules[i]));
      return save();
    }
  }
  return false;
}

static void captureRoom(scene_t *sc, uint8_t roomId) {
  sc->nsteps = 0;
  sc->roomId = roomId;
  for(uint8_t i = 0; i < SOMFY_MAX_SHADES && sc->nsteps < AUTO_SCENE_STEPS; i++) {
    SomfyShade *s = &somfy.shades[i];
    if(skipShade(s)) continue;
    if(roomId && s->roomId != roomId) continue;
    scene_step_t &st = sc->steps[sc->nsteps++];
    st.shadeId = s->getShadeId();
    float p = s->transformPosition(s->currentPos);
    st.pos = p < 0 ? 0 : (p > 100 ? 100 : (int8_t)(p + 0.5f));
    if(s->tiltType != tilt_types::none) {
      float t = s->transformPosition(s->currentTiltPos);
      st.tilt = t < 0 ? 0 : (t > 100 ? 100 : (int8_t)(t + 0.5f));
    } else st.tilt = -1;
  }
}

bool AutomationController::saveScene(WebServer &server) {
  DynamicJsonDocument doc(6144);
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if(err) {
    server.send(400, "application/json", "{\"status\":\"ERROR\",\"desc\":\"JSON\"}");
    return false;
  }
  JsonObject obj = doc.as<JsonObject>();
  uint8_t id = obj["id"] | 0;
  if(obj["delete"] | false) {
    sendOk(server, deleteScene(id));
    return true;
  }
  scene_t *sc = id ? sceneById(id) : emptyScene();
  if(!sc && id) sc = emptyScene();
  if(!sc) {
    server.send(400, "application/json", "{\"status\":\"ERROR\",\"desc\":\"No scene slots\"}");
    return false;
  }
  if(!sc->id) {
    uint8_t used[AUTO_MAX_SCENES + 1];
    memset(used, 0, sizeof(used));
    for(uint8_t i = 0; i < AUTO_MAX_SCENES; i++)
      if(scenes[i].id && scenes[i].id <= AUTO_MAX_SCENES) used[scenes[i].id] = 1;
    uint8_t nid = 1;
    while(nid <= AUTO_MAX_SCENES && used[nid]) nid++;
    sc->id = nid;
  }
  const char *name = obj["name"] | "";
  if(name[0]) strlcpy(sc->name, name, AUTO_NAME_LEN);
  else if(!sc->name[0]) snprintf(sc->name, AUTO_NAME_LEN, "Scene %u", sc->id);
  sc->roomId = obj["roomId"] | sc->roomId;
  if(obj["capture"] | false) {
    captureRoom(sc, sc->roomId);
  } else if(obj.containsKey("steps")) {
    JsonArray arr = obj["steps"].as<JsonArray>();
    sc->nsteps = 0;
    for(JsonObject st : arr) {
      if(sc->nsteps >= AUTO_SCENE_STEPS) break;
      uint8_t sid = st["shadeId"] | 0;
      if(!sid) continue;
      int pos = st["pos"] | 0;
      int tilt = st.containsKey("tilt") ? (int)st["tilt"] : -1;
      scene_step_t &step = sc->steps[sc->nsteps++];
      step.shadeId = sid;
      step.pos = pos < 0 ? 0 : (pos > 100 ? 100 : (int8_t)pos);
      step.tilt = tilt < -1 ? -1 : (tilt > 100 ? 100 : (int8_t)tilt);
    }
  }
  save();
  JsonResponse resp;
  resp.beginResponse(&server, autoJson, sizeof(autoJson));
  resp.beginObject();
  resp.addElem("ok", true);
  resp.addElem("id", sc->id);
  resp.addElem("name", sc->name);
  resp.endObject();
  resp.endResponse();
  return true;
}

bool AutomationController::saveSchedule(WebServer &server) {
  DynamicJsonDocument doc(512);
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if(err) {
    server.send(400, "application/json", "{\"status\":\"ERROR\",\"desc\":\"JSON\"}");
    return false;
  }
  JsonObject obj = doc.as<JsonObject>();
  uint8_t id = obj["id"] | 0;
  if(obj["delete"] | false) {
    sendOk(server, deleteSchedule(id));
    return true;
  }
  schedule_t *slot = nullptr;
  if(id) {
    for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++)
      if(schedules[i].id == id) { slot = &schedules[i]; break; }
  }
  if(!slot) {
    for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++)
      if(schedules[i].id == 0) { slot = &schedules[i]; break; }
  }
  if(!slot) {
    server.send(400, "application/json", "{\"status\":\"ERROR\",\"desc\":\"No schedule slots\"}");
    return false;
  }
  if(!slot->id) {
    uint8_t used[AUTO_MAX_SCHEDULES + 1];
    memset(used, 0, sizeof(used));
    for(uint8_t i = 0; i < AUTO_MAX_SCHEDULES; i++)
      if(schedules[i].id && schedules[i].id <= AUTO_MAX_SCHEDULES) used[schedules[i].id] = 1;
    uint8_t nid = 1;
    while(nid <= AUTO_MAX_SCHEDULES && used[nid]) nid++;
    slot->id = nid;
  }
  if(obj.containsKey("enabled")) slot->enabled = obj["enabled"] ? 1 : 0;
  else slot->enabled = 1;
  uint8_t hour = obj["hour"] | slot->hour;
  uint8_t minute = obj["minute"] | slot->minute;
  slot->hour = hour > 23 ? 23 : hour;
  slot->minute = minute > 59 ? 59 : minute;
  slot->days = obj.containsKey("days") ? (uint8_t)obj["days"] : slot->days;
  slot->kind = obj["kind"] | 0;
  slot->target = obj["target"] | 0;
  if(obj.containsKey("cmd")) slot->cmd = obj["cmd"];
  const char *cs = obj["command"] | "";
  if(cs[0]) {
    if(!strcasecmp(cs, "up") || !strcasecmp(cs, "open")) slot->cmd = 0;
    else if(!strcasecmp(cs, "down") || !strcasecmp(cs, "close")) slot->cmd = 2;
    else if(!strcasecmp(cs, "stop")) slot->cmd = 3;
    else slot->cmd = 1;
  }
  save();
  JsonResponse resp;
  resp.beginResponse(&server, autoJson, sizeof(autoJson));
  resp.beginObject();
  resp.addElem("ok", true);
  resp.addElem("id", slot->id);
  resp.endObject();
  resp.endResponse();
  return true;
}

void AutomationController::handleHttp(WebServer &server) {
  if(server.method() == HTTP_OPTIONS) { server.send(200, "OK"); return; }
  if(mesh.isRepeater()) {
    server.send(403, "application/json", "{\"status\":\"ERROR\",\"desc\":\"Repeater\"}");
    return;
  }
  String uri = server.uri();
  HTTPMethod m = server.method();
  if(uri == "/scenes" && m == HTTP_GET) {
    JsonResponse resp;
    resp.beginResponse(&server, autoJson, sizeof(autoJson));
    resp.beginObject();
    resp.beginArray("scenes");
    toJSONScenes(resp);
    resp.endArray();
    resp.endObject();
    resp.endResponse();
    return;
  }
  if(uri == "/scenes" && (m == HTTP_PUT || m == HTTP_POST)) {
    saveScene(server);
    return;
  }
  if(uri == "/schedules" && m == HTTP_GET) {
    JsonResponse resp;
    resp.beginResponse(&server, autoJson, sizeof(autoJson));
    resp.beginObject();
    resp.beginArray("schedules");
    toJSONSchedules(resp);
    resp.endArray();
    resp.endObject();
    resp.endResponse();
    return;
  }
  if(uri == "/schedules" && (m == HTTP_PUT || m == HTTP_POST)) {
    saveSchedule(server);
    return;
  }
  if(uri == "/sceneCommand" && (m == HTTP_PUT || m == HTTP_POST)) {
    uint8_t id = 0;
    if(server.hasArg("id")) id = atoi(server.arg("id").c_str());
    else if(server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      if(!deserializeJson(doc, server.arg("plain"))) id = doc["id"] | 0;
    }
    sendOk(server, applyScene(id));
    return;
  }
  if(uri == "/roomCommand" && (m == HTTP_PUT || m == HTTP_POST)) {
    uint8_t roomId = 0;
    char cmd[16];
    cmd[0] = 0;
    if(server.hasArg("roomId")) roomId = atoi(server.arg("roomId").c_str());
    if(server.hasArg("command")) strlcpy(cmd, server.arg("command").c_str(), sizeof(cmd));
    if(server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      if(!deserializeJson(doc, server.arg("plain"))) {
        roomId = doc["roomId"] | roomId;
        const char *c = doc["command"] | "";
        if(c[0]) strlcpy(cmd, c, sizeof(cmd));
      }
    }
    sendOk(server, roomCommand(roomId, cmd));
    return;
  }
  server.send(404, "application/json", "{\"status\":\"ERROR\"}");
}
