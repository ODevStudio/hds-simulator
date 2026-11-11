#include "adapter.h"
#include "build_metadata.h"
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#ifndef __EMSCRIPTEN__
#include <iostream>
#endif

NativeDisplay u8g2;
JsonDocument input;
unsigned long simNow = 0;
String simVersion, simDate, simRevision, simDeviceName, simSsid, simIp, simWifiMode;
bool simBleConnected = false, simCircle = false, simSquare = false, simUsb = false;
bool simCharging = false, simWifiConnected = false, simWifiCredentials = false;
int simBatteryPercent = 75;
unsigned long simTimerSeconds = 0;
bool b_negativeWeight = false, b_timeOnTop = false, b_screenFlipped = false;
bool b_ble_enabled = false, b_is_charging = false, b_wifiEnabled = false;
bool b_wifiOnBoot = false, b_btnFuncWhileConnected = false, b_requireHeartBeat = true;
bool b_autoSleep = true, b_quickBoot = false, b_heartBeatIcon = false;
bool b_hasFuelGauge = false, b_showStatusData = false, b_showWifiData = false;
bool b_showAbout = false, b_showLogo = false, b_showNumber = false;
bool b_shutdownFailBle = false;
int i_weightInt = 0, i_weightFirstDecimal = 0;
float f_displayedValue = 0, f_batteryVoltage = 3.8f, f_maxDriftCompensation = .05f;
unsigned long t_tareStatus = 0, t_shutdownFailBle = 0, t_menuExitTime = 0;
unsigned long t_oled_refresh = 0;
constexpr int BUTTON_CIRCLE = 1, BUTTON_SQUARE = 2, USB_DET = 3, LOW = 0;
constexpr int WIFI_STA = 1, WIFI_AP = 2, WL_CONNECTED = 3;
constexpr int KEY_SCREEN_FLIP = 1;
struct { unsigned long batterySampleSequence = 1; } powerCadence;
struct { unsigned long elapsed() { return simTimerSeconds; } } stopWatch;
String actionMessage = "Default", actionMessage2 = "Default";
unsigned long t_actionMessage = 0, lastMenuFrameRender = 0;
int t_actionMessageDelay = 0;
bool menuFrameDirty = true, menuFrameShowsActionMessage = false;
int currentPage = 1, totalPages = 1, currentIndex = 0, currentMenuSize = 0;
constexpr int linesPerPage = HDS_SIM_MENU_ROWS;
std::vector<String> menuNames;
std::vector<Menu> menuEntries;
std::vector<const Menu *> menuPointers;
const Menu *const *currentMenu = nullptr;
const Menu *currentSelection = nullptr;
char minsec[10] = {};

unsigned long millis() { return simNow; }
int digitalRead(int pin) {
  return (pin == BUTTON_CIRCLE ? simCircle : pin == BUTTON_SQUARE ? simSquare : simUsb) ? LOW : 1;
}
int batteryPercent() { return simBatteryPercent; }
bool bleHasLiveClient() { return simBleConnected; }
bool fuelGaugeCharging() { return simCharging; }
bool fuelGaugeUsbPlugged() { return simUsb; }
FuelGaugeReading fuelGaugeReading() { return {}; }
bool storageGetBool(int, bool) { return b_screenFlipped; }
void invalidateEnergyOledFrame() {}
void processMenuInfoPageExit() {}
bool renderMenuInfoPage() { return false; }
bool menuFrameNeedsRender(unsigned long) { return true; }
void refreshMenuRows() {}
bool wifiCredentialsSaved() { return simWifiCredentials; }
const char *wifiDeviceName() { return simDeviceName.c_str(); }
struct NativeIp { String toString() { return simIp; } };
struct {
  bool isConnected() { return simWifiConnected; }
  int status() { return simWifiConnected ? WL_CONNECTED : 0; }
  int getMode() { return simWifiMode == "AP" ? WIFI_AP : WIFI_STA; }
  String SSID() { return simSsid; }
  NativeIp localIP() { return {}; }
} WiFi;

#define V8_1
#define HDS_FEATURE_WIFI 1
#define HDS_ENABLE_GRINDER 0
#define HDS_ENABLE_ENERGY_MENU 0
#define FIRMWARE_VER simVersion.c_str()
#define LINE3 simDate.c_str()
#define GIT_REV simRevision.c_str()
#include "production.inc"

void NativeDisplay::drawXBM(int x, int y, int width, int height, const uint8_t *bitmap) {
  if (bitmap == image_battery_charging && !(simUsb && simCharging)) {
    const int bucket = EnergyRuntimePolicy::batteryDisplayBucket(simBatteryPercent);
    if (bucket == 0 && !((simNow / 500) & 1)) return;
    const uint8_t *const batteryIcons[] = {
      image_battery_0, image_battery_1, image_battery_2, image_battery_3, image_battery_4
    };
    bitmap = batteryIcons[bucket];
    ++y;
  }
  u8g2_DrawXBM(&display, x, y, width, height, bitmap);
}

String readText(JsonVariantConst value, const char *fallback = "") {
  const char *text = value.is<const char *>() ? value.as<const char *>() : fallback;
  return String(text, std::min<size_t>(std::strlen(text), 256));
}

unsigned long readMillis(JsonVariantConst value) {
  if (!value.is<double>()) return 0;
  const double number = value.as<double>();
  if (!std::isfinite(number) || number < 0) return 0;
  return static_cast<uint32_t>(std::fmod(std::trunc(number), 4294967296.0));
}

unsigned long remainingMillis(JsonVariantConst value, unsigned long now) {
  if (!value.is<double>() || !std::isfinite(value.as<double>()) || value.as<double>() <= 0) return 0;
  const unsigned long remaining = static_cast<uint32_t>(readMillis(value) - now);
  return remaining < 0x80000000UL ? remaining : 0;
}

void configureSnapshot() {
  const JsonVariantConst root = input.as<JsonVariantConst>();
  const auto settings = root["settings"];
  const auto icons = root["icons"];
  const auto info = root["info"];
  simNow = readMillis(root["now"]);
  f_displayedValue = root["weight"] | 0.0f;
  if (!std::isfinite(f_displayedValue)) f_displayedValue = 0;
  simTimerSeconds = readMillis(root["timerMs"]) / 1000;
  b_screenFlipped = settings["screenFlipped"] | false;
  b_timeOnTop = settings["timeOnTop"] | false;
  b_wifiOnBoot = settings["wifiOnBoot"] | false;
  b_btnFuncWhileConnected = settings["bleButtons"] | false;
  b_requireHeartBeat = settings["requireHeartbeat"] | true;
  b_autoSleep = settings["autoSleep"] | true;
  b_quickBoot = settings["quickBoot"] | false;
  f_maxDriftCompensation = settings["driftCompensation"] | .05f;
  b_ble_enabled = icons["bleEnabled"] | false;
  b_wifiEnabled = icons["wifiEnabled"] | false;
  simBleConnected = icons["bleConnected"] | false;
  simWifiConnected = icons["wifiConnected"] | false;
  simUsb = icons["usbPresent"] | false;
  simCharging = icons["charging"] | false;
  b_heartBeatIcon = icons["heartbeat"] | false;
  simBatteryPercent = std::clamp(icons["batteryPercent"] | 75, 0, 100);
  simCircle = root["held"]["circle"] | false;
  simSquare = root["held"]["square"] | false;
  simVersion = readText(info["firmwareVersion"], "FW: 3.1.16");
  simDate = readText(info["buildDate"], "Nov 09 2026");
  simRevision = readText(info["revision"], HDS_SIM_COMMIT_SHORT);
  simDeviceName = readText(info["deviceName"], "hds-simulator");
  simSsid = readText(info["ssid"], "N/A");
  simIp = readText(info["ip"], "0.0.0.0");
  simWifiMode = readText(info["wifiMode"], "Idle");
  simWifiCredentials = info["wifiCredentialsSaved"] | false;
  f_batteryVoltage = info["batteryVoltage"] | 3.8f;
  const unsigned long tareRemaining = remainingMillis(root["tareUntil"], simNow);
  t_tareStatus = static_cast<uint32_t>(simNow + (tareRemaining ? tareRemaining - 500UL : -1000UL));
  const unsigned long shutdownRemaining = remainingMillis(root["shutdownUntil"], simNow);
  b_shutdownFailBle = shutdownRemaining > 0;
  t_shutdownFailBle = static_cast<uint32_t>(simNow + shutdownRemaining - 3000UL);
  t_menuExitTime = static_cast<uint32_t>(simNow - 2000UL);
  const auto feedback = root["feedback"];
  actionMessage = readText(feedback["text"], "Default");
  actionMessage2 = readText(feedback["text2"], "Default");
  if (actionMessage2.empty()) actionMessage2 = "Default";
  t_actionMessage = simNow;
  t_actionMessageDelay = static_cast<int>(remainingMillis(feedback["until"], simNow));
  menuNames.clear();
  const auto rows = root["menu"]["rows"].as<JsonArrayConst>();
  for (JsonVariantConst row : rows) {
    if (menuNames.size() == 64) break;
    menuNames.push_back(readText(row));
  }
  menuEntries.clear();
  menuPointers.clear();
  for (const auto &name : menuNames) menuEntries.push_back({name.c_str()});
  for (const auto &entry : menuEntries) menuPointers.push_back(&entry);
  currentMenuSize = static_cast<int>(menuPointers.size());
  currentIndex = std::clamp(root["menu"]["selected"] | 0, 0, std::max(0, currentMenuSize - 1));
  currentMenu = menuPointers.data();
  currentSelection = currentMenuSize ? currentMenu[currentIndex] : nullptr;
}

void drawWeighing() {
  const auto prompt = input["prompt"];
  const bool showPrompt = (prompt["visible"] | false) && !b_shutdownFailBle && f_displayedValue <= OVER_WEIGHT;
  u8g2.firstPage();
  do {
    u8g2.setDrawColor(1);
    if (showPrompt) {
      const String text = readText(prompt["text"]);
      drawWeightAt(f_displayedValue, LCDHeight - 30);
      u8g2.setFont(u8g2_font_6x10_tr);
      const AppPromptScrollState scroll = {true, 1, readMillis(prompt["startedAt"])};
      const int x = appPromptTextX(scroll, u8g2.getUTF8Width(text.c_str()), LCDWidth, simNow);
      u8g2.drawStr(x, LCDHeight - 16, text.c_str());
    } else {
      drawWeightAt(f_displayedValue, -1);
      drawTime();
    }
    u8g2.setDrawColor(2);
    drawBattery(simNow);
    if (!showPrompt) drawButton();
    drawBle(simNow);
    drawHeartBeat();
    drawTare();
    drawShutdownFail();
  } while (u8g2.nextPage());
}

extern "C" const uint8_t *hdsRender(const char *json) {
  static bool initialized = false;
  static uint8_t output[128 * 64];
  if (!initialized) {
    u8g2_Setup_sh1106_128x64_noname_f(&u8g2.display, U8G2_R0,
      [](u8x8_t *, uint8_t, uint8_t, void *) -> uint8_t { return 1; },
      [](u8x8_t *, uint8_t, uint8_t, void *) -> uint8_t { return 1; });
    initialized = true;
  }
  if (!json || std::strlen(json) > 16384 || deserializeJson(input, json)) {
    std::memset(output, 0, sizeof(output));
    return output;
  }
  configureSnapshot();
  u8g2.setDisplayRotation(b_screenFlipped ? U8G2_R0 : U8G2_R2);
  u8g2_ClearBuffer(&u8g2.display);
  u8g2_SetFontMode(&u8g2.display, 1);
  u8g2.setDrawColor(1);
  const String screen = readText(input["screen"], "weighing");
  if (t_actionMessageDelay > 0) showMenu();
  else if (screen == "boot" || screen == "logo") {
    b_showNumber = false;
    renderBootLogo();
  } else if (screen == "logoSample") {
    b_showNumber = true;
    showLogo();
  } else if (screen == "setup" || screen == "off") {
    char setup[] = "HDS Setup", off[] = "Off";
    refreshOLED(screen == "setup" ? setup : off, FONT_M);
  } else if (screen == "status") showStatus();
  else if (screen == "about") showAbout();
  else if (screen == "wifiStatus" || screen == "wifi") showWifiStatus();
  else if (screen == "batteryInfo" || screen == "battery") drawBatInfoPage(input["info"]["batteryPage"] | 0);
  else if (screen == "charging") {
    t_oled_refresh = static_cast<uint32_t>(simNow - 1000UL);
    chargingOLED(simBatteryPercent, f_batteryVoltage);
  } else if (screen == "weighing") drawWeighing();
  else showMenu();
  const auto buffer = u8g2_GetBufferPtr(&u8g2.display);
  for (int y = 0; y < 64; ++y) {
    for (int x = 0; x < 128; ++x) output[y * 128 + x] = (buffer[x + (y / 8) * 128] >> (y % 8)) & 1;
  }
  return output;
}

extern "C" const char *hdsMetadata() {
  return "{\"width\":128,\"height\":64,\"sourceCommit\":\"" HDS_SIM_COMMIT
    "\",\"controller\":\"SH1106\",\"u8g2Version\":\"2.36.18\",\"physicalRotation\":true,"
    "\"simulatorCorrections\":" HDS_SIM_CORRECTIONS_JSON "}";
}

#ifndef __EMSCRIPTEN__
int main() {
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  std::string line;
  while (std::getline(std::cin, line)) std::fwrite(hdsRender(line.c_str()), 1, 8192, stdout);
}
#endif
