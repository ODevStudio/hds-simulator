# Local Control API

The optional Node server serves the simulator and a JSON-RPC 2.0 WebSocket API.
An open browser page owns the simulation; the server relays commands to it.
There is no Bluetooth, physical scale, shell access, or server-side renderer.
Static hosting still works without this API.

## Start

Prepared Windows and macOS bundles already include the required runtime and
dependencies. Use their `START.cmd` or `START.command` launcher; no installation
is needed. The launcher prints the URL and private connection-file location.

When running a source checkout instead, use Node 22 or newer. From the
repository root:

```sh
npm ci --prefix examples/hds-simulator
node examples/hds-simulator/server.mjs
```

Open `http://localhost:18916/` and keep the simulator page open. The renderer
must already be built. The server binds only to `127.0.0.1`, not the LAN.
`--port` changes the port; `--connection-file` changes the private connection
file. The default file is `.pio.nosync/hds-simulator-control/connection.json`
under the repository root, outside the served application directory.

The connection file contains `wsUrl` and a random `token`. Read it locally;
do not publish it, put the token in a URL, or commit the file. A server restart
creates a new token. The browser obtains it through the same-origin
`/api/config` endpoint. Foreign Host and Origin headers are rejected.

Every WebSocket connection must authenticate within three seconds:

```json
{"jsonrpc":"2.0","id":1,"method":"auth","params":{"token":"TOKEN_FROM_CONNECTION_FILE","role":"controller"}}
```

Requests need a unique integer or short string `id`. Responses contain that
`id` and either `result` or `error: {code, message}`. Batch requests are not
supported. Keep commands sequential when their order matters.

## Discover And Read

| Method | Parameters | Result |
| --- | --- | --- |
| `instances.list` | `{}` | `{instances: [{instanceId, label, connectedAt}]}` |
| `state.get` | `{instanceId?}` | `{snapshot, ui}` |
| `settings.get` | `{instanceId?}` | Current firmware-style settings |
| `controls.describe` | `{instanceId?}` | Fields, buttons, current values, limits, and enabled states |
| `subscribe` | `{instanceId?}` | Enable state notifications |
| `unsubscribe` | `{instanceId?}` | Disable notifications |

Omit `instanceId` on a routed method only when exactly one page is connected.
No page returns error `-32001`; multiple pages return `-32002`. Each loaded
page gets a new ID. Enumerate again after reloads.

`snapshot` includes the screen, virtual time, gross/net weight, pouring,
timer, menu rows/selection, icons, settings, held buttons, prompt, and feedback.
`ui` includes `playing`, `view` (`detail` or `full`), `clean`, and `fields`/
`buttons` keyed by their IDs. Fields expose `{value, enabled}`; physical
buttons also expose `held`. The prompt field is a draft; `snapshot.prompt`
is the text actually sent to the simulated scale.
Empty or unparsable numeric drafts have `value: null`, not zero. The committed
values remain available in `snapshot.controls` until a valid edit is entered.

Subscriptions send `state.changed` notifications with `{instanceId, state}`.
Omitting the subscription target watches all current and future pages.
`instances.changed` reports page connection/disconnection. State is published
on actions and the existing 100 ms simulation redraw cadence, not each OLED
pixel. Paused simulations publish only when something changes.

## Control

Include `instanceId` alongside the parameters below when targeting a page.
Mutations return the updated `{snapshot, ui}`.

| Method | Parameters | Behavior |
| --- | --- | --- |
| `field.set` | `{id, value}` | Set a field through its normal UI handler |
| `button.press` | `{id}` | Click a control, or immediately press/release a physical button |
| `button.down` | `{id}` | Hold Circle or Square |
| `button.up` | `{id}` | Release that controller's Circle or Square hold |
| `clock.pause` | `{}` | Pause virtual time |
| `clock.resume` | `{}` | Resume virtual time |
| `clock.advance` | `{ms}` | Pause and advance 0-86400000 ms |

Field IDs:

- Numbers: `weight` (-10000 to 10000, step 0.1), `pour-rate` (0 to 1000,
  step 1), `battery` (0 to 100, step 1).
- Booleans: `ble-enabled`, `ble-connected`, `wifi-enabled`, `wifi-connected`,
  `usb-present`, `charging`.
- `prompt`: a draft of 0-128 printable ASCII characters.
- `scene`: `boot`, `weighing`, `main`, `scale`, `connections`, `display`,
  `power`, or `info`.

Button IDs:

`tare`, `pour`, `setup-boot`, `reset-defaults`, `clear-prompt`, `show-prompt`,
`play-pause`, `step`, `restart`, `view-detail`, `view-full`, `clean-view`,
`exit-clean`, `double-tap`, `triple-tap`, `circle`, `square`.

Numeric step buttons are `weight-step-up`, `weight-step-down`,
`pour-rate-step-up`, and `pour-rate-step-down`. Each activation changes the
value by one field step, without hold-to-repeat acceleration.

Disabled controls remain disabled through the API (`-32010`). Invalid types,
ranges, step values, unknown IDs, and unknown parameters fail without changing
state (`-32602`). A conflicting button owner returns `-32011`. API or controller
disconnection cancels its held buttons without firing a short press. It does
not release buttons held by another controller or by local pointer/keyboard.
A failed or timed-out `button.down` also cancels that controller's target holds.

App Text still requires its Display-menu opt-in and a simulated app connection.
Settings are changed through the same menu buttons as on the scale; there is
no setting-write bypass. The full current settings are always readable.

For repeatable holds and chords, pause first. For example, send `button.down`
for both `circle` and `square`, `clock.advance` by 500 ms, then `button.up` for
both. This opens Main when USB is present. A 900 ms single-button hold follows
the firmware long-press behavior. Keep the same controller socket open during
the sequence. `clock.advance` renders immediately, including in clean view;
live playback uses the browser's animation scheduling.

## Example

This Node example pauses, selects weighing, tares, pours 12.5 g in virtual
time, stops pouring, then prints the net weight and settings. It deliberately
changes the selected page's runtime state and leaves the clock paused:

```sh
node examples/hds-simulator/tools/control-example.mjs .pio.nosync/hds-simulator-control/connection.json
```

With multiple open pages, append an `instanceId` from `instances.list`.
For instructional video automation, use the same JSON-RPC commands from the
AI's WebSocket client and capture the browser externally. The API does not
record video or export SVG.
