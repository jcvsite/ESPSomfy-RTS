/**
 * FixedCode.h — Fixed-code device list and pulse capture API.
 */

#ifndef FIXEDCODE_H
#define FIXEDCODE_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <FS.h>
#include "WResp.h"

#define FIXED_MAX_SWITCHES 8
#define FIXED_MAX_PULSES 120
#define FIXED_NAME_LEN 32
#define FIXED_DEFAULT_FREQ 433.92f
#define FIXED_DEFAULT_REPEATS 5
#define FIXED_LEARN_GAP_US 35000
#define FIXED_LEARN_FRAME_GAP_US 4500
#define FIXED_LEARN_MIN_PULSES 16
#define FIXED_LEARN_IDEAL_MAX 56
#define FIXED_LEARN_MAX_ACCEPT FIXED_MAX_PULSES
#define FIXED_LEARN_TIMEOUT_MS 20000
#define FIXED_LEARN_SETTLE_MS 800
#define FIXED_LEARN_MIN_SIGNAL_MS 80
#define FIXED_LEARN_MIN_RSSI -90
#define FIXED_INTER_REPEAT_US 10000
// Same-direction anti-flood vs quick ON↔OFF reverse (match shade gaps).
#define FIXED_TX_CMD_MIN_MS        1500
#define FIXED_TX_REVERSE_CMD_MIN_MS 400

enum class fixed_learn_btn : uint8_t { none = 0, on = 1, off = 2 };
// command() result codes
enum class fixed_cmd_result : int8_t { error = -1, rate_limited = 0, ok = 1 };

void fixedCodeFormatPreview(const uint16_t *pulses, uint16_t count, char *out, size_t outLen);
uint32_t fixedCodeFingerprint(const uint16_t *pulses, uint16_t count);
// Keep one RF frame (drop button-hold repeats). Returns new length.
uint16_t fixedCodeTrimToFrame(uint16_t *pulses, uint16_t count);

struct FixedCodeSwitch {
  uint8_t id = 0;
  char name[FIXED_NAME_LEN] = "";
  float frequency = FIXED_DEFAULT_FREQ;
  uint8_t repeats = FIXED_DEFAULT_REPEATS;
  bool state = false;
  bool singleButton = false; // one RF code used for both ON and OFF (toggle remotes)
  bool flipCommands = false; // swap which pulse bank is transmitted for ON/OFF
  uint16_t onCount = 0;
  uint16_t offCount = 0;
  uint16_t onPulses[FIXED_MAX_PULSES];
  uint16_t offPulses[FIXED_MAX_PULSES];
  uint32_t lastTxMs = 0;
  int8_t lastTxWantOn = -1; // -1 none, 0 off, 1 on (logical request)

  void clear();
  bool hasOn() const { return onCount >= FIXED_LEARN_MIN_PULSES; }
  bool hasOff() const { return offCount >= FIXED_LEARN_MIN_PULSES; }
  bool ready() const { return singleButton ? hasOn() : (hasOn() && hasOff()); }
  bool canTransmit(bool wantOn) const;
  uint32_t txRetryAfterMs(bool wantOn) const;
  void fromJSON(JsonObject &obj);
  void toJSON(JsonResponse &json);
  void emitState(uint8_t num = 255);
  void publish();
  void publishDisco();
  void unpublishDisco();
  void unpublish();
  bool setState(bool on, bool transmit = true);
};

class FixedCodeController {
  uint32_t lastCommit = 0;
  uint8_t learnId = 0;
  fixed_learn_btn learnBtn = fixed_learn_btn::none;
  uint32_t learnStarted = 0;
public:
  bool isDirty = false;
  FixedCodeSwitch switches[FIXED_MAX_SWITCHES];

  void begin();
  void loop();
  void commit();
  void load();
  void save();
  void writeBackup();
  bool appendToBackup(File &dst);
  bool extractFromRestoreFile(const char *path);
  bool restoreFromBackup();

  uint8_t count() const;
  uint8_t getNextId();
  FixedCodeSwitch *getById(uint8_t id);
  FixedCodeSwitch *add(JsonObject &obj);
  bool saveSwitch(JsonObject &obj);
  bool remove(uint8_t id);
  // ok / rate_limited / error; optional retryAfterMs out when rate_limited
  fixed_cmd_result command(uint8_t id, const char *state, uint32_t *retryAfterMs = nullptr);
  bool beginLearn(uint8_t id, fixed_learn_btn btn);
  void endLearn(bool cancel = false);
  void onLearnComplete(const uint16_t *pulses, uint16_t count);
  bool isLearning() const;
  void toJSON(JsonResponse &json);
  void publish();
  void emitAll(uint8_t num = 255);
  void emitLearnProgress();
};

extern FixedCodeController fixedCodes;

#endif
