# HDS Simulator

Extract the whole archive before starting. Keep the files together.

On Windows, double-click `START.cmd`. On macOS, double-click `START.command`.
Choose the Apple Silicon package for an M-series Mac, or the Intel package for
an Intel Mac. The package includes Node.js, its dependency, and the prebuilt
OLED renderer. You do not need npm, Python, or build tools to run it.

Keep the launcher window open while using the simulator. Press Ctrl+C in that
window to stop. If the browser does not open, use the local address printed in
the window. macOS may ask you to approve software downloaded from the internet;
review the package before approving it in System Settings. Do not disable your
security settings or remove quarantine flags for an untrusted download.

The server listens on this computer only. It tries port 18916, then up to nine
following ports if another program owns that port. Browser settings belong to
the address and port, so keep using `127.0.0.1:18916` when possible.

The simulator cannot flash firmware or operate real scales, plugs, or sensors.
All controls affect the local simulation. `app/API.md` describes the optional
authenticated local WebSocket API.

The launcher stores its private API connection file outside the served app:

- Windows: `%LOCALAPPDATA%\HDS-Simulator\connection.json`
- macOS: `~/Library/Application Support/HDS-Simulator/connection.json`

Treat that file as a local control credential. Do not publish it.

After starting the simulator, you can run the included API example from the
package folder. It pours 12.5 g in virtual time and leaves the clock paused.

Windows:

```cmd
runtime\node.exe app\tools\control-example.mjs "%LOCALAPPDATA%\HDS-Simulator\connection.json"
```

macOS:

```sh
./runtime/node app/tools/control-example.mjs "$HOME/Library/Application Support/HDS-Simulator/connection.json"
```

`LICENSE` and `licenses/` contain license texts and font notices.
`sources/` contains matching firmware and renderer source plus pinned library
source for inspection and developer rebuilds. The JavaScript source is in `app/`.
See `sources/README.md` before rebuilding or redistributing.

The Windows bundle has been tested on Windows. The macOS runtime downloads and
archive executable permissions have been verified; this package has not been
executed on a Mac.
