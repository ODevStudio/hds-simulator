import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "examples/hds-simulator"
EMSCRIPTEN_VERSION = "3.1.74"
U8G2_VERSION = "2.36.18"
SIMULATOR_CORRECTIONS = ("usb-charging-icon-uses-actual-charging-state",)


def sourceFunction(text, signature):
    start = re.search(r"(?m)^" + re.escape(signature) + r"\s*\{", text)
    if not start:
        raise ValueError(f"Missing production renderer: {signature}")
    end = re.search(r"(?m)^\}", text[start.end():])
    if not end:
        raise ValueError(f"Missing production renderer end: {signature}")
    return text[start.start():start.end() + end.end()]


def generateProduction(cache):
    files = {name: (ROOT / name).read_text(encoding="utf-8") for name in (
        "include/display.h", "include/config.h", "include/boot_startup.h",
        "include/menu.h", "include/fuel_gauge_menu.h", "src/hds.ino")}
    display = files["include/display.h"]
    macros = ("FONT_L", "FONT_M", "FONT_S", "FONT_TIMER", "FONT_GRAM", "FONT_WEIGHT",
              "FONT_EXTRACTION", "LCDWidth", "LCDHeight", "AC(T)", "AR(T)", "AM()", "AT()")
    output = [next(line.split("//")[0].rstrip() for line in display.splitlines()
                   if line.startswith(f"#define {name} ")) for name in macros]
    for name in ("OVER_WEIGHT", "Margin_Top", "Margin_Bottom", "Margin_Left", "Margin_Right"):
        output.append(next(line.split("//")[0].rstrip() for line in files["include/config.h"].splitlines()
                           if line.startswith(f"#define {name} ")))
    output.extend(line for line in display.splitlines() if line.startswith("static const unsigned char image_"))
    functions = {
        "include/display.h": ("char* sec2sec(unsigned long n)", "char* ltrim(char* s)",
                              "char* rtrim(char* s)", "char* trim(char* s)",
                              "void refreshOLED(char* input, const uint8_t* font)"),
        "include/boot_startup.h": ("void renderBootLogo()",),
        "src/hds.ino": ("void separateFloat(float number)", "void drawWeightAt(float input, int baseline)",
                        "void drawTime()", "void drawButton()", "void drawBle(unsigned long now)",
                        "void drawHeartBeat()", "void drawBattery(unsigned long now)", "void drawTare()",
                        "void drawShutdownFail()", "void chargingOLED(int perc, float voltage)"),
        "include/menu.h": ("void showWifiStatus()", "void showStatus()", "void showAbout()",
                           "void showLogo()", "void showMenu()"),
        "include/fuel_gauge_menu.h": ("static uint8_t batInfoTotalPages()", "static void drawBatInfoPage(uint8_t page)"),
    }
    for name, signatures in functions.items():
        output.extend(sourceFunction(files[name], signature) for signature in signatures)
    (cache / "production.inc").write_text("\n\n".join(output) + "\n", encoding="utf-8")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    menuRows = int(re.search(r"const int linesPerPage\s*=\s*(\d+)\s*;", files["include/menu.h"]).group(1))
    (cache / "build_metadata.h").write_text(
        f'#define HDS_SIM_COMMIT "{commit}"\n#define HDS_SIM_COMMIT_SHORT "{commit[:7]}"\n'
        f'#define HDS_SIM_MENU_ROWS {menuRows}\n'
        f'#define HDS_SIM_CORRECTIONS_JSON {json.dumps(json.dumps(SIMULATOR_CORRECTIONS))}\n', encoding="utf-8")
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
    for name in ("include/app_prompt_scroll.h", "include/energy_runtime_policy.h", "include/mdns_name.h",
                 "examples/hds-simulator/renderer/adapter.h", "examples/hds-simulator/renderer/renderer.cpp",
                 "tools/build_hds_simulator.py"):
        hashes[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    return {"sourceCommit": commit, "sourceHashes": hashes, "productionFunctions": functions,
            "emscriptenVersion": EMSCRIPTEN_VERSION, "u8g2Version": U8G2_VERSION,
            "simulatorCorrections": SIMULATOR_CORRECTIONS}


def runResponse(program, arguments, cache, name, env):
    response = cache / f"{name}.rsp"
    response.write_text("\n".join('"' + str(arg).replace("\\", "/").replace('"', '\\"') + '"'
                                   for arg in arguments), encoding="utf-8")
    subprocess.run([*program, "@" + str(response)], cwd=cache, env=env, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--emsdk", type=Path, default=os.environ.get("EMSDK"))
    parser.add_argument("--u8g2-dir", type=Path, default=ROOT / ".pio.nosync/libdeps/esp32s3/U8g2/src/clib")
    parser.add_argument("--arduino-json-dir", type=Path, default=ROOT / ".pio.nosync/libdeps/esp32s3/ArduinoJson/src")
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--native", action="store_true")
    args = parser.parse_args()
    if not args.emsdk:
        parser.error("Pass --emsdk or set EMSDK to an activated Emscripten 3.1.74 SDK")
    sdk = args.emsdk.resolve()
    cache = (args.cache_dir or sdk.parent / "hds-simulator-cache").resolve()
    cache.mkdir(parents=True, exist_ok=True)
    temporary = cache / "tmp"
    temporary.mkdir(exist_ok=True)
    emcc = sdk / "upstream/emscripten/emcc.py"
    empp = sdk / "upstream/emscripten/em++.py"
    if not emcc.is_file() or not (sdk / ".emscripten").is_file():
        parser.error("Emscripten SDK is incomplete or not activated")
    if not (args.u8g2_dir / "u8g2.h").is_file() or not (args.arduino_json_dir / "ArduinoJson.h").is_file():
        parser.error("Pass the existing U8g2 2.36.18 clib and ArduinoJson 7.4.3 src directories; no firmware SDK build is needed")
    libraryProperties = args.u8g2_dir.parent.parent / "library.properties"
    if libraryProperties.is_file() and not re.search(r"(?m)^version=2\.36\.18\s*$", libraryProperties.read_text()):
        parser.error("Expected pinned U8g2 2.36.18")
    jsonVersion = (args.arduino_json_dir / "ArduinoJson/version.hpp").read_text()
    if '#define ARDUINOJSON_VERSION "7.4.3"' not in jsonVersion:
        parser.error("Expected pinned ArduinoJson 7.4.3")
    env = dict(os.environ, EMSDK=str(sdk), EM_CONFIG=str(sdk / ".emscripten"),
               EM_CACHE=str(cache / "emscripten-cache"), PYTHONDONTWRITEBYTECODE="1",
               TMP=str(temporary), TEMP=str(temporary), TMPDIR=str(temporary))
    version = subprocess.check_output([sys.executable, str(emcc), "--version"], env=env, text=True)
    if not re.search(r"\b3\.1\.74\b", version):
        raise RuntimeError("Expected pinned Emscripten 3.1.74")
    metadata = generateProduction(cache)
    dist = APP / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    includes = ["-I", str(ROOT / "include"), "-I", str(args.u8g2_dir),
                "-I", str(args.arduino_json_dir), "-I", str(cache)]
    pathMaps = [f"-ffile-prefix-map={path.resolve()}={name}" for path, name in (
        (ROOT, "."), (args.u8g2_dir, "u8g2"), (args.arduino_json_dir, "arduino-json"),
        (cache, "generated"), (sdk, "emscripten"))]
    sources = [str(path) for path in sorted(args.u8g2_dir.glob("*.c"))]
    libraryHash = hashlib.sha256("".join(hashlib.sha256(Path(path).read_bytes()).hexdigest()
                                         for path in sources).encode()).hexdigest()
    libraryKey = hashlib.sha256((libraryHash + "portable-paths-v1").encode()).hexdigest()[:16]
    wasmLibrary = cache / f"u8g2-{libraryKey}.wasm.o"
    if not wasmLibrary.is_file():
        runResponse([sys.executable, str(emcc)], ["-O2", "-r", "-DU8G2_16BIT=", *pathMaps, *includes,
                    *sources, "-o", str(wasmLibrary)], cache, "wasm-library", env)
    renderer = APP / "renderer/renderer.cpp"
    runResponse([sys.executable, str(empp)], ["-O2", "-std=c++17", "-DU8G2_16BIT=", *pathMaps, *includes,
                str(renderer), str(wasmLibrary), "-sMODULARIZE=1", "-sEXPORT_ES6=1",
                "-sENVIRONMENT=web,node", "-sALLOW_MEMORY_GROWTH=1", "-sFILESYSTEM=0",
                "-sEXPORTED_FUNCTIONS=['_hdsRender','_hdsMetadata','_malloc','_free']",
                "-sEXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString']", "--no-entry",
                "-o", str(dist / "renderer.mjs")], cache, "wasm-renderer", env)
    nativeExecutable = None
    if args.native:
        gcc, gpp = shutil.which("gcc"), shutil.which("g++")
        if not gcc or not gpp:
            raise RuntimeError("Native parity checks require gcc and g++")
        nativeLibrary = cache / f"u8g2-{libraryKey}.native.o"
        if not nativeLibrary.is_file():
            runResponse([gcc], ["-O2", "-r", "-DU8G2_16BIT=", *pathMaps, *includes, *sources,
                        "-o", str(nativeLibrary)], cache, "native-library", env)
        executable = cache / ("renderer-native.exe" if os.name == "nt" else "renderer-native")
        runResponse([gpp], ["-O2", "-std=c++17", "-DU8G2_16BIT=", *pathMaps, *includes,
                    str(renderer), str(nativeLibrary), "-o", str(executable)], cache, "native-renderer", env)
        nativeExecutable = str(executable)
    metadata["u8g2SourceHash"] = libraryHash
    (dist / "renderer-meta.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"wasm": str(dist / "renderer.wasm"), "metadata": str(dist / "renderer-meta.json"),
                      "nativeExecutable": nativeExecutable, "cache": str(cache)}))


if __name__ == "__main__":
    main()
