/**
 * SomfyController.ino — Main Arduino entry: setup/loop, WDT, OTA lock, and subsystem dispatch.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <esp_task_wdt.h>
#include <esp_ota_ops.h>
#include "ConfigSettings.h"
#include "Network.h"
#include "Web.h"
#include "Sockets.h"
#include "Utils.h"
#include "Somfy.h"
#include "MQTT.h"
#include "GitOTA.h"
#include "Recovery.h"
#include "FixedCode.h"
#include "Mesh.h"
#include "Automation.h"
#include <Update.h>

ConfigSettings settings;
Web webServer;
SocketEmitter sockEmit;
Network net;
rebootDelay_t rebootDelay;
SomfyShadeController somfy;
MQTTClass mqtt;
GitUpdater git;

uint32_t oldheap = 0;
void setup() {
  #if defined(LED_PIN) && LED_PIN != -1
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  #endif
  Serial.begin(115200);
  Serial.println();
  Serial.println("Startup/Boot....");
  // Must run before any init that might reboot/crash. With
  // CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE, a PENDING_VERIFY image rolls back
  // on the next reset unless marked valid — late mark-valid after net.setup()
  // made OTA appear to succeed then silently return to the previous FW.
  {
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t st;
    if(running && esp_ota_get_state_partition(running, &st) == ESP_OK &&
       st == ESP_OTA_IMG_PENDING_VERIFY) {
      if(esp_ota_mark_app_valid_cancel_rollback() == ESP_OK)
        Serial.println(F("OTA image marked valid (rollback cancelled)"));
      else
        Serial.println(F("OTA mark-valid failed"));
    }
  }
  handlePowerCycleReset();
  Serial.println("Mounting File System...");
  if(LittleFS.begin()) Serial.println("File system mounted successfully");
  else Serial.println("Error mounting file system");
  if(_pendingFactory) performFactoryReset();
  settings.begin();
  if(_pendingNetSecuRecovery) resetAccessAndNetworkConfig();
  if(WiFi.status() == WL_CONNECTED) WiFi.disconnect(true);
  delay(10);
  Serial.println();
  webServer.startup();
  webServer.begin();
  delay(1000);
  net.setup();
  somfy.begin();
  mesh.begin();
  fixedCodes.begin();
  automation = new AutomationController();
  if(automation) automation->begin();
  esp_task_wdt_init(15, true); //enable panic so ESP32 restarts
  esp_task_wdt_add(NULL); //add current thread to WDT watch

}

void loop() {
  // put your main code here, to run repeatedly:
  //uint32_t heap = ESP.getFreeHeap();
  if(rebootDelay.reboot && millis() > rebootDelay.rebootTime) {
    Serial.print("Rebooting after ");
    Serial.print(rebootDelay.rebootTime);
    Serial.println("ms");
    net.end();
    ESP.restart();
    return;
  }
  net.loop();
  esp_task_wdt_reset();
  // Do not pump RF / FS writers while an OTA flash is in progress.
  if(!Update.isRunning() && !git.lockFS) {
    somfy.loop();
    esp_task_wdt_reset();
    mesh.loop();
    esp_task_wdt_reset();
    fixedCodes.loop();
    esp_task_wdt_reset();
    if(automation) automation->loop();
    esp_task_wdt_reset();
  }
  if(net.connected() || net.softAPOpened) {
    if(!rebootDelay.reboot && net.connected() && !net.softAPOpened) {
      git.loop();
      esp_task_wdt_reset();
    }
    webServer.loop();
    esp_task_wdt_reset();
    sockEmit.loop();
    esp_task_wdt_reset();
  }
  if(rebootDelay.reboot && millis() > rebootDelay.rebootTime) {
    net.end();
    ESP.restart();
  }
  esp_task_wdt_reset();
}
