/**
 * Web.h — WebServer wrapper and route/handler declarations.
 */

#include <WebServer.h>
#include "Somfy.h"
#ifndef webserver_h
#define webserver_h
class Web {
public:
  bool uploadSuccess = false;
  void handleLang(WebServer &server);
  void handleSetLang(WebServer &server);

  void sendCORSHeaders(WebServer &server);
  void sendCacheHeaders(uint32_t seconds = 604800);
  void startup();
  void handleLogin(WebServer &server);
  void handleLogout(WebServer &server);
  void handleStreamFile(WebServer &server, const char *filename, const char *encoding);
  void handleController(WebServer &server);
  void handleLoginContext(WebServer &server);
  void handleGetRepeaters(WebServer &server);
  void handleGetRooms(WebServer &server);
  void handleGetShades(WebServer &server);
  void handleGetGroups(WebServer &server);
  void handleGetFixedCodes(WebServer &server);
  void handleShadeCommand(WebServer &server);
  void handleRepeatCommand(WebServer &server);
  void handleGroupCommand(WebServer &server);
  void handleTiltCommand(WebServer &server);
  void handleFixedCodeCommand(WebServer &server);
  void handleSaveFixedCode(WebServer &server);
  void handleDiscovery(WebServer &server);
  void handleNotFound(WebServer &server);
  void handleRoom(WebServer &server);
  void handleShade(WebServer &server);
  void handleGroup(WebServer &server);
  void handleSetPositions(WebServer &server);
  void handleSetSensor(WebServer &server);
  void handleDownloadFirmware(WebServer &server);
  void handleBackup(WebServer &server, bool attach = false);
  void handleReboot(WebServer &server);
  void handleDeserializationError(WebServer &server, DeserializationError &err);
  void begin();
  void loop();
  void end();
  // Web Handlers
  bool createAPIToken(const IPAddress ipAddress, char *token);
  bool createAPIToken(const char *payload, char *token);
  bool createAPIPinToken(const IPAddress ipAddress, const char *pin, char *token);
  bool createAPIPasswordToken(const IPAddress ipAddress, const char *username, const char *password, char *token);
  bool isAuthenticated(WebServer &server, bool cfg = false);
  // After a successful LittleFS image write: remount and rewrite shades/fixedcodes from RAM.
  // Requires a usable /index.html before restoring (refuse truncated UI images).
  bool remountAndRestoreUserConfig();
  // Mount-only check after Update(U_SPIFFS). Call before sending the HTTP response so the
  // browser is not blocked on shade commits. Then call restoreUserConfigToFilesystem().
  bool remountFilesystemAfterUpdate(bool requireUi = true);
  void restoreUserConfigToFilesystem();
  // After a failed/aborted LittleFS write: remount or reformat, then rewrite user data from RAM
  // (UI may be missing — caller should not reboot until a good FS image is flashed).
  bool recoverUserConfigAfterFsFailure();
  // True when firmware was flashed with reboot deferred (package FW-then-FS). Cleared on success reboot or rollback.
  bool pendingFwRollback = false;
  void rollbackPendingFirmware();

};
#endif
