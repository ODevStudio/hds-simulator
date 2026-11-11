#ifndef HDS_SIMULATOR_ADAPTER_H
#define HDS_SIMULATOR_ADAPTER_H

#include <ArduinoJson.h>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "u8g2.h"
#include "app_prompt_scroll.h"
#include "energy_runtime_policy.h"
#include "mdns_name.h"

struct String : std::string {
  using std::string::string;
  using std::string::operator=;
  String(const std::string &value) : std::string(value) {}
};

struct NativeDisplay {
  u8g2_t display;
  void setFont(const uint8_t *font) { u8g2_SetFont(&display, font); }
  void setDrawColor(uint8_t color) { u8g2_SetDrawColor(&display, color); }
  void setDisplayRotation(const u8g2_cb_t *rotation) { u8g2_SetDisplayRotation(&display, rotation); }
  int getDisplayWidth() { return u8g2_GetDisplayWidth(&display); }
  int getDisplayHeight() { return u8g2_GetDisplayHeight(&display); }
  int getUTF8Width(const char *text) { return u8g2_GetUTF8Width(&display, text); }
  int getMaxCharHeight() { return u8g2_GetMaxCharHeight(&display); }
  void firstPage() { u8g2_FirstPage(&display); }
  bool nextPage() { return u8g2_NextPage(&display); }
  void drawStr(int x, int y, const char *text) { u8g2_DrawStr(&display, x, y, text); }
  void drawUTF8(int x, int y, const char *text) { u8g2_DrawUTF8(&display, x, y, text); }
  void drawBox(int x, int y, int width, int height) { u8g2_DrawBox(&display, x, y, width, height); }
  void drawGlyph(int x, int y, uint16_t glyph) { u8g2_DrawGlyph(&display, x, y, glyph); }
  void drawXBM(int x, int y, int width, int height, const uint8_t *bitmap);
};

struct FuelGaugeReading {
  bool valid = true;
  unsigned voltageMv = 3800;
  int temperature = 2981, currentMa = 0, powerMw = 0;
  unsigned capacityMah = 750, fullCapacityMah = 1000, soh = 100, soc = 75;
};

struct Menu { const char *name; };

#endif
