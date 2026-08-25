/**
 * NoLog.h — Compile-time Serial stub to shrink flash in selected TUs.
 */

#pragma once
// Drop Serial print/printf in a translation unit to recover flash.
struct NoLogSerial {
  void begin(unsigned long) {}
  template<typename T> void print(const T &) {}
  template<typename T> void print(const T &, int) {}
  void println() {}
  template<typename T> void println(const T &) {}
  template<typename T> void println(const T &, int) {}
  template<typename... A>
  void printf(const char *, A...) {}
  int available() { return 0; }
  operator bool() const { return true; }
};
static NoLogSerial NoLog;
#undef Serial
#define Serial NoLog
