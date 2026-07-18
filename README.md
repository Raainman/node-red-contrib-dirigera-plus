# node-red-contrib-dirigera-plus

Node-RED nodes for the **IKEA DIRIGERA** smart-home hub.

This package lets you **control** devices, rooms and scenes registered on your
DIRIGERA hub **and — new in this package — receive live *events* pushed by the
hub** (motion detected, buttons pressed, contact sensors opened/closed, lights
switched, brightness changed, …) through its websocket interface.

> **Lineage / credit.** This is a fork of
> [`node-red-contrib-dirigera`](https://github.com/zinen/node-red-contrib-dirigera)
> by **zinen** (MIT). The original control nodes are kept as-is; this package
> adds a new `dirigera events` node plus the shared websocket event
> infrastructure. All original functionality remains compatible.

---

## Why this fork?

The original node can *send* commands and *read* state on request, but it does
not surface the asynchronous events the hub emits on its own. Home-automation
flows often need to *react* to the physical world — a motion sensor tripping, a
remote button being pressed, a door contact opening. `dirigera-plus` adds a
dedicated event node for exactly that, without polling.

**What's new compared to the original:**

- A new **`dirigera events`** node that emits hub events in real time.
- **One shared websocket** connection per hub config node, no matter how many
  event nodes you deploy — efficient and easy on the hub.
- **Automatic reconnect** with exponential backoff (1 s, doubling up to 60 s).
- Optional **filters** by event type, specific device, and device type.

---

## Installation

From the Node-RED editor: **Menu → Manage palette → Install** and search for
`node-red-contrib-dirigera-plus`.

Or from the command line in your Node-RED user directory (usually `~/.node-red`):

```bash
npm install node-red-contrib-dirigera-plus
```

Then restart Node-RED and reload the editor in your browser.

> If you previously had `node-red-contrib-dirigera` installed, uninstall it
> first to avoid two palettes registering the same `dirigera` node type:
> `npm remove node-red-contrib-dirigera`.

---

## Configuration: the hub (config node)

All nodes share a **DIRIGERA hub** config node. You create it once:

1. Drag any DIRIGERA node onto a flow and open it.
2. Next to **Config**, click the pencil to add a new hub.
3. Enter the hub's **IP address or hostname** (find it in your router or the
   IKEA Home smart app).
4. Click **Get access token**, then — within a few seconds — **press the action
   button on the bottom of the DIRIGERA hub**. The token is fetched and stored
   automatically. You only do this once.

The hub uses a self-signed TLS certificate; the nodes connect over HTTPS/WSS and
accept it (standard for local DIRIGERA access).

---

## Node: `dirigera` (control)

Sends commands to, or reads state from, a device / room / scene. Behaviour is
unchanged from the original package.

- **Set:** provide `msg.topic` = capability (e.g. `isOn`, `lightLevel`,
  `colorTemperature`, `blindsTargetLevel`) and `msg.payload` = the value.
- **Get:** send a message **without** `msg.topic` to read the current state into
  `msg.payload`; supported capabilities are returned in `msg.availableTopics`.
- **Override:** pick *Override (msg.deviceId)* / *Override (msg.roomId)* in the
  dropdown to target a device/room chosen at runtime from the message.

See `examples/basic-blinds.json` for a control example.

---

## Node: `dirigera events`

Outputs live events pushed by the hub. It has **no input** and **one output**.

### Configuration

| Field | Meaning |
|-------|---------|
| **Config** | The DIRIGERA hub config node to listen on. |
| **Event type** | Only pass events of this type. Empty = all. Common values: `deviceStateChanged`, `deviceAdded`, `deviceRemoved`, `sceneUpdated`, `sceneCreated`, `sceneDeleted`. |
| **Device** | Only pass events for one specific device. The dropdown is populated from the hub — **deploy the config node once first**, then reopen the node. Empty = all devices. |
| **Device type** | Only pass events for devices of this type, e.g. `motionSensor`, `light`, `outlet`, `openCloseSensor`, `controller`. Empty = all types. |

Filters combine with AND. Leave them all empty to receive everything.

### Output message

| Property | Description |
|----------|-------------|
| `msg.topic` | The event type, e.g. `deviceStateChanged`. |
| `msg.payload` | The event `data`: `id`, `type`, `deviceType` and the changed `attributes` (e.g. `{ isOn: true }`, `{ isDetected: true }`, `{ lightLevel: 40 }`). |
| `msg.event` | The complete raw event including `id`, `time` and `source`. |

### Example: react to a motion sensor

```
[ dirigera events ]  →  [ switch: payload.attributes.isDetected == true ]  →  [ turn light on ]
```

1. Add a **`dirigera events`** node, select your hub, set **Device type** =
   `motionSensor` (or pick the specific sensor under **Device**).
2. Wire it into a `switch`/`function` that inspects
   `msg.payload.attributes.isDetected`.
3. Wire the result into a **`dirigera`** control node set to `isOn` on your light.

A ready-made flow is in `examples/events-basic.json` (event node → debug).

### Node status

The event node shows its connection state in the editor:

- 🟢 **connected** — websocket open, events flowing.
- 🟡 **connecting** — establishing / reconnecting.
- 🔴 **disconnected** — connection lost; it will retry automatically.

---

## How the websocket connection works

- One websocket per hub config node is shared by **all** event nodes bound to
  that hub. The connection opens when the first event node is deployed and
  closes when the last one is removed.
- On any drop it reconnects automatically with exponential backoff (max 60 s).
- The connection uses the same access token as the control nodes — no extra
  pairing needed.

---

## Requirements

- Node-RED **3.0+**, Node.js **16+**.
- A local IKEA DIRIGERA hub reachable on your network.

---

## License

MIT. See [LICENSE](LICENSE). Original work © 2023 zinen; event extensions and
this distribution © 2026 the `node-red-contrib-dirigera-plus` contributors.
