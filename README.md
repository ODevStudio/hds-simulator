# HDS Simulator

A photo-backed browser simulator for the Half Decent Scale. The OLED uses the
firmware's U8g2 fonts, icons and drawing functions through WebAssembly. A local
WebSocket API lets automation operate the same controls and read the state.

## Standalone Downloads

The packages include the renderer, photo, runtime and server dependencies.
No Python, npm, compiler or library installation is needed to run them.

| Computer | Download |
| --- | --- |
| Windows x64 | [HDS-Simulator-Windows-x64.zip](https://github.com/ODevStudio/hds-simulator/releases/download/v0.1.0/HDS-Simulator-Windows-x64.zip) |
| Mac with Apple silicon | [HDS-Simulator-macOS-Apple-Silicon.tar.gz](https://github.com/ODevStudio/hds-simulator/releases/download/v0.1.0/HDS-Simulator-macOS-Apple-Silicon.tar.gz) |
| Mac with Intel processor | [HDS-Simulator-macOS-Intel.tar.gz](https://github.com/ODevStudio/hds-simulator/releases/download/v0.1.0/HDS-Simulator-macOS-Intel.tar.gz) |

Extract the entire archive. Double-click `START.cmd` on Windows or
`START.command` on macOS. Keep the launcher window open; Ctrl+C stops the
server. It binds only to this computer, tries port 18916, and opens the browser.

**Mac limitation:** the launcher is unsigned and not notarized. A native Mac
launch has not been tested. Only approve a package you trust using Apple's
[Privacy & Security instructions](https://support.apple.com/en-us/102445).
Do not disable Gatekeeper or remove quarantine flags from untrusted downloads.

[Release notes](https://github.com/ODevStudio/hds-simulator/releases/tag/v0.1.0)
and [SHA-256 checksums](SHA256SUMS.txt) describe the exact reviewed archives.

## Simulation

- Boot, weighing, standard menus, information pages and Circle/Square gestures.
- One controllable clock for timers, pouring, blinking and scrolling App Text.
- Independent applied weight and tare offset; the initial pour rate is 3 g/s.
- Full-scale, enlarged-display and clean recording views.
- Local connection/battery fixtures and authenticated WebSocket control.

Number arrows advance one step per activation without hold-to-repeat
acceleration. USB presence alone does not show a charging bolt: inactive
charging shows the firmware's battery-level icon instead.

This is a browser simulation, not an ESP32 or electrical-hardware emulator.
It cannot operate physical scales, access Bluetooth, flash firmware, record
video, or export SVG/GIF. Hardware-only menu actions remain unavailable.

## API

See the [API reference](examples/hds-simulator/API.md) for authentication,
control IDs, settings/state readback, subscriptions and deterministic holds.
The open browser page owns the simulation; the server only relays commands.

The launcher prints the private connection-file location. Treat its token as
a local control credential, and do not publish or commit it.

## Run From Source

Use Node.js 22 or newer:

```sh
npm ci --prefix examples/hds-simulator
node examples/hds-simulator/server.mjs
```

Open `http://localhost:18916/`. Prebuilt renderer files are committed under
`examples/hds-simulator/dist/`, so this does not need a compiler.

## Renderer Rebuild

The initial renderer derives from standard V8.1 HDS firmware
[`6f2ac69`](https://github.com/decentespresso/openscale/commit/6f2ac693f7acfc7f476157d36320d7aa67c467fd),
version 3.1.16. Simulator changes were prepared on 2026-11-11. Its metadata
records the reference source hashes and the explicit USB charging-icon
correction; firmware reference files were not changed for that correction.

Only changing the native OLED renderer requires Python and an activated
Emscripten 3.1.74 SDK. U8g2 2.36.18 and ArduinoJson 7.4.3 source is vendored:

```sh
python tools/build_hds_simulator.py --emsdk /path/to/emsdk --u8g2-dir vendor/U8g2/src/clib --arduino-json-dir vendor/ArduinoJson/src
```

No ESP-IDF or PlatformIO build is needed. `include/`, `src/` and
`platformio.ini` preserve firmware reference source for extraction and tests;
this standalone repository does not provide a supported hardware-firmware build.
Future rebuilds record this repository's current Git commit as their source
commit. The simulated firmware fixture remains pinned to the version above.

## Verification

```sh
node --test examples/hds-simulator/tests/state.test.mjs examples/hds-simulator/tests/button-input.test.mjs examples/hds-simulator/tests/api-bridge.test.mjs examples/hds-simulator/tests/server-security.mjs
node examples/hds-simulator/tests/api.mjs
node examples/hds-simulator/tests/numeric-controls.mjs
```

Browser checks require Playwright Chromium, and numeric-control checks also
require Playwright Firefox. Existing installations can be selected through
`PLAYWRIGHT_MODULE_PATH`, `PLAYWRIGHT_CHROMIUM_PATH` and `PLAYWRIGHT_FIREFOX_PATH`.
The [developer README](examples/hds-simulator/README.md) lists additional
native/WASM pixel and photo-framing checks.

The reviewed build passed 289 Chromium/Firefox numeric checks, 125 API checks,
860 native/WASM frames, 160 charging-icon comparisons, 22 unchanged menu/sample
comparisons, and 28 photo-framing views. The Windows portable package was
executed; Mac archive hashes, shell syntax and executable permissions were
verified without executing a Mac runtime.

## Licenses And Credits

HDS-derived code is provided under [GPLv3](LICENSE). The firmware and scale
photograph originate from Decent Espresso; libraries, fonts and the photo
retain their own terms. The photo is not relicensed by the code's GPL grant.

See [third-party notices](THIRD_PARTY_NOTICES.md) and the complete notices in
`licenses/`, including the unresolved upstream Logisoso license discrepancy.
The exact downloadable archives retain their original packaging notes.
