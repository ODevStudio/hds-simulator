# HDS Browser Simulator

A local, browser-only simulator of standard V8.1 HDS firmware at `6f2ac69`
(3.1.16). It runs the firmware's U8g2 drawing functions, fonts and icons in
WebAssembly, with a separate deterministic model for buttons, settings and time.
It is not an ESP32 or electrical-hardware emulator.

One simulator-only correction replaces the charging bolt with the actual
battery-level icon when USB is present but charging is inactive. It uses the
firmware's battery buckets, blink timing and bitmap assets wherever a charging
icon is drawn. Existing sample icons and menus without charging icons remain
unchanged. Firmware source stays pinned; renderer metadata records the correction.

## Run Without Build Tools

In a prepared bundle, double-click `START.cmd` on Windows or `START.command`
on macOS. Choose the Apple silicon or Intel Mac bundle for that computer.
The launcher starts the local server and opens the simulator, including its
WebSocket control API. Keep that window open while using it; Ctrl+C stops it.

The bundle includes the prebuilt WebAssembly renderer, its fonts and icons,
the photograph, the server dependencies, and a portable Node runtime. Python,
npm, Emscripten, and library installation are not needed to run it. No files
are installed globally. Saved settings remain in the browser.

The instructions below are only for rebuilding the renderer from source,
not for running a prepared bundle. This repository includes prebuilt `dist/`
files; see the root README to run them with Node.js. JavaScript and CSS changes
do not require rebuilding WebAssembly.

## Developer Build

Install and activate Emscripten **3.1.74** using the upstream
[emsdk instructions](https://emscripten.org/docs/getting_started/downloads.html).
Set `EMSDK` to that installation. Keep its cache on a drive with several GB free.
No ESP-IDF or PlatformIO firmware build is required.

The renderer uses the same pinned libraries as the firmware:

- U8g2 **2.36.18**, its `src/clib` directory.
- ArduinoJson **7.4.3**, its `src` directory.

Use existing PlatformIO library downloads, or unpack those exact library
versions from the [PlatformIO registry](https://registry.platformio.org/).
The build script checks their version metadata. It does not install or repair
the global PlatformIO core.

From the repository root:

```sh
python tools/build_hds_simulator.py --emsdk /path/to/emsdk --u8g2-dir /path/to/U8g2/src/clib --arduino-json-dir /path/to/ArduinoJson/src --native
python -m http.server 18916 --bind 127.0.0.1 --directory examples/hds-simulator
```

Open `http://127.0.0.1:18916/`. Rebuilding replaces the checked-in `dist/` files.
The build cache defaults beside the SDK; `--cache-dir` overrides it. The optional
`--native` reference requires `gcc` and `g++` and enables native/WASM parity
verification. The browser needs only the resulting static app files, not Python,
the native executable, a server API, or a Bluetooth companion.

## Controls

The photograph's Circle and Square buttons accept pointer and touch presses.
Keyboard users can focus a button and use Space or Enter, or use C and S when
not editing a field. Holds use simulation time. Focus loss cancels held input.

The clock can run, pause, or advance 100 ms. When paused, hold a button while
stepping to inspect a long press or the two-button chord. All blinking, pouring,
timer, feedback and scrolling use this same clock.

Circle tares and Square cycles the timer in weighing mode, subject to the
firmware's BLE-button rules. In menus, Circle release advances and a 900 ms hold
moves backward. Square enters or activates; its hold returns to Main or exits.
With USB present, holding both buttons for 500 ms opens Main. Setup boot models
holding both through startup. Screen selection supplies direct scene shortcuts.

Applied weight and tare offset are independent. Pouring changes applied weight
at the configured grams per second, initially 3 g/s. Displayed net weight follows
the offset.
Number arrows change one step per click without accelerating on a hold. Valid
typed values update the simulation immediately.
Connection, power and battery controls are local fixture inputs, not device APIs.
The optional [local WebSocket API](API.md) exposes these same controls and
current settings for repeatable AI-driven demonstrations.
The 2x/3x surface-tap controls inject completed tap gestures after their Scale
menu settings are enabled. They retain firmware action guards but do not model
the ADC pulse detector. They are separate from tapping Circle and Square.

App Text defaults Off, as in firmware. Enable it through Display and connect the
simulated app before showing a prompt. Show writes accept 1-128 printable ASCII
characters. Identical writes preserve scroll phase; Circle hold cancels prompts
for that connection. Disconnect/reconnect starts a new session.

Only simulated settings persist in `hds-simulator.settings.v1`. Restart retains
them; Reset Defaults replaces only this simulator's settings. Runtime weight,
timer and connection state are not stored across page reloads.

## Covered Screens

Boot, setup, weighing, standard menus, Status, About, WiFi Status, Logo, legacy
Battery Info, transient feedback and App Text use actual firmware rasterization.
Both panel rotations are supported. The photo presentation compensates for the
V8.1 panel's fixed mounting rotation.

The default fixture is a USB-present normal reset, not an attachment-triggered
charging wake: legacy battery hardware, BLE advertising, no WiFi connection.
The boot logo lasts one simulated second; physical startup time varies.

Calibration, WiFi Update and Custom Build retain their menu rows but do not
perform hardware workflows. Their status is reported outside the OLED. No
optional plugin profiles, real BLE, editor, SVG/GIF export or built-in recording
are included. Clean view hides controls for external screen recording; Escape
restores them.

## Verification

```sh
node --test examples/hds-simulator/tests/state.test.mjs
node --test examples/hds-simulator/tests/button-input.test.mjs examples/hds-simulator/tests/api-bridge.test.mjs examples/hds-simulator/tests/server-security.mjs
node examples/hds-simulator/tests/render-parity.mjs /path/to/cache/renderer-native
node examples/hds-simulator/tests/browser.mjs
node examples/hds-simulator/tests/numeric-controls.mjs
node examples/hds-simulator/tests/framing.mjs
node examples/hds-simulator/tests/api.mjs
```

The browser check needs Playwright and a running local preview. Set
`PLAYWRIGHT_MODULE_PATH` or `PLAYWRIGHT_CHROMIUM_PATH` when using an existing
installation, and `HDS_SIMULATOR_URL` for a different loopback port.
The numeric-control checks also use Playwright Firefox; set
`PLAYWRIGHT_FIREFOX_PATH` for an existing Firefox test runtime.
Screenshots go to `.pio.nosync/hds-simulator-checks/` by default.
Use the native executable path printed by the build (`.exe` on Windows), or set
`HDS_NATIVE_RENDERER` and omit the parity command's path argument. Local tool
paths are not included in the distributable app metadata.

Native/WASM checks compare raw buffers across screens, clocks and rotations.
Browser checks cover fixed mounting, controls, persistence failures, desktop
and touch layouts, and nonblank OLED output. Simulated checks do not qualify
real BLE transport, power management or physical weighing accuracy.

The scale photograph was supplied for this simulator. Icons outside the OLED
are extracted from Lucide 1.8.0 under the license in `assets/lucide-LICENSE`.
The OLED fonts and icons are supplied by U8g2 and the existing firmware.
