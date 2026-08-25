/**
 * Automation.h — Scene/schedule structs and AutomationController API.
 */

#ifndef automation_h
#define automation_h
#include <Arduino.h>
#include <FS.h>
#include <WebServer.h>
#include "WResp.h"

#define AUTO_MAX_SCENES 8
#define AUTO_SCENE_STEPS 48
#define AUTO_NAME_LEN 24
#define AUTO_MAX_SCHEDULES 8
#define AUTO_QMAX 48

struct scene_step_t {
  uint8_t shadeId;
  int8_t pos;
  int8_t tilt;
};
struct scene_t {
  uint8_t id;
  char name[AUTO_NAME_LEN];
  uint8_t roomId;
  uint8_t nsteps;
  scene_step_t steps[AUTO_SCENE_STEPS];
};
struct schedule_t {
  uint8_t id;
  uint8_t enabled;
  uint8_t hour;
  uint8_t minute;
  uint8_t days;
  uint8_t kind;
  uint8_t target;
  uint8_t cmd;
};

class AutomationController {
  public:
    bool begin();
    void loop();
    bool save();
    bool load();
    bool appendToBackup(File &dst);
    bool restoreFromBackup();
    void handleHttp(WebServer &server);
    bool roomCommand(uint8_t roomId, const char *cmd);
    bool applyScene(uint8_t id);
    void toJSONScenes(JsonResponse &json);
    void toJSONSchedules(JsonResponse &json);
  private:
    scene_t scenes[AUTO_MAX_SCENES];
    schedule_t schedules[AUTO_MAX_SCHEDULES];
    uint8_t qKind[AUTO_QMAX];
    uint8_t qId[AUTO_QMAX];
    uint8_t qA[AUTO_QMAX];
    int8_t qB[AUTO_QMAX];
    uint8_t qn;
    uint8_t qh;
    uint32_t lastQms;
    int lastSchedMin;
    void clearAll();
    void enqueue(uint8_t kind, uint8_t id, uint8_t a, int8_t b);
    void pumpQueue();
    void checkSchedules();
    scene_t *sceneById(uint8_t id);
    scene_t *emptyScene();
    bool saveScene(WebServer &server);
    bool saveSchedule(WebServer &server);
    bool deleteScene(uint8_t id);
    bool deleteSchedule(uint8_t id);
};

extern AutomationController *automation;
#endif
