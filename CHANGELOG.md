# Changelog

## 1.0.1

### Fixed

- Fixed REST client recovery when Node-RED starts while the DIRIGERA hub is unavailable.
- Added automatic REST reconnection with exponential backoff from 3 seconds up to 60 seconds.
- The DIRIGERA connection now automatically recovers when the hub becomes available again, without requiring a Node-RED redeploy or restart.
- REST reconnect timers are cleaned up correctly when the config node is closed or redeployed.

## 1.0.0
First release of `node-red-contrib-dirigera-plus`, forked from
`node-red-contrib-dirigera` 1.3.0 by zinen.

### Added
- New `dirigera events` node emitting live hub events over the websocket
  interface (`wss://<hub>:8443/v1`).
- One shared websocket per hub config node, reused by all event nodes.
- Automatic reconnect with exponential backoff (1 s → max 60 s).
- Optional filters: event type, specific device, device type.
- Connection status shown on the event node (connecting / connected /
  disconnected).

### Notes
- All original control functionality (device/room/scene set & get) is retained
  and unchanged.
