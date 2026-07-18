module.exports = function (RED) {
  'use strict'
  const DirigeraHub = require('node-dirigera-promise')
  const WebSocket = require('ws')

  const handleError = (res, errorText, done) => {
    if (done) return
    res.json(JSON.stringify({ error: errorText }))
    done = true
  }

  RED.httpAdmin.get('/ikeaDirigera/auth', RED.auth.needsPermission('dirigera.write'), async function (req, res) {
    let done = false
    const hubAddress = String(req.query.hubAddress)
    if (!hubAddress) {
      handleError(res, 'Hub address empty. Missing ip or hostname to use.', done)
      return
    }
    res.setTimeout(60000, function () {
      handleError(res, 'Button push was not registered at address: ' + hubAddress, done)
    })
    try {
      const hubOptions = {
        hubAddress,
        clientName: req.query.clientName || 'node-red-dirigera',
        debug: 0
      }
      const dirigeraHub = new DirigeraHub(hubOptions)
      res.json(JSON.stringify({ access_token: await dirigeraHub.getAccessToken() }))
      done = true
    } catch (error) {
      handleError(res, '/ikeaDirigera/auth > getAccessToken:err > ' + String(error), done)
    }
  })

  RED.httpAdmin.get('/ikeaDirigera/dirigera', RED.auth.needsPermission('dirigera.read'), async function (req, res) {
    const node = RED.nodes.getNode(req.query.nodeId) || {}
    if (!node.dirigeraClient) {
      res.json('{"Make and deploy config first":[{"name":"Make and deploy config first", "id":-1}]}')
      return
    }
    try {
      const result = { specificDevice: [] }
      const devices = await node.dirigeraClient.getDevice()
      for (const device of devices) {
        try {
          const roomName = device.room?.name || '(no room defined)'
          result.specificDevice.push({ name: `${device.type || ''} - ${roomName} - ${device.attributes.customName || ''}`, id: device.id })
          if (device.type === 'gateway') continue
          const roomID = device.room?.id || ''
          if (!result[device.type]) {
            result[device.type] = [{ name: 'Override (msg.roomId)', id: 'overrideRoom' }, { name: roomName, id: roomID }]
          } else if (!result[device.type].some(item => item.id === roomID)) {
            result[device.type].push({ name: roomName, id: roomID })
          }
        } catch (error) {
          console.error('/ikeaDirigera/dirigera-API-Error:', error, device)
        }
      }
      result.specificDevice.sort((a, b) => a.name.localeCompare(b.name))
      result.specificDevice.unshift({ name: 'Override (msg.deviceId)', id: 'overrideDevice' })
      const scenes = await node.dirigeraClient.getScene()
      result.scene = scenes.map(scene => ({ name: scene.info.name, id: scene.id }))
      res.json(JSON.stringify(result))
    } catch (error) {
      res.json('{"Error see console":[{"name":"' + String(error) + '", "id":-1}]}')
      node.error('Dirigera get devices error: ' + error)
    }
  })

  function DirigeraConfigNode (n) {
    RED.nodes.createNode(this, n)
    const node = this
    // --- Event/WebSocket handling ---
    node.eventListeners = new Set()
    node.ws = null
    node.wsReconnectTimer = null
    node.wsReconnectDelay = 1000
    node.wsClosing = false

    function notifyStatus (status) {
      for (const listener of node.eventListeners) {
        try { listener.onWsStatus(status) } catch (_) {}
      }
    }

    function startWebSocket () {
      if (node.ws || node.wsClosing) return
      if (!node.credentials.hubAddress || !node.credentials.hubAccessCode) return
      const url = 'wss://' + node.credentials.hubAddress + ':8443/v1'
      notifyStatus('connecting')
      let ws
      try {
        ws = new WebSocket(url, {
          headers: { Authorization: 'Bearer ' + node.credentials.hubAccessCode },
          rejectUnauthorized: false // Hub uses a self-signed certificate
        })
      } catch (error) {
        node.error('Dirigera websocket create error: ' + error)
        scheduleReconnect()
        return
      }
      node.ws = ws
      ws.on('open', () => {
        node.wsReconnectDelay = 1000
        notifyStatus('connected')
      })
      ws.on('message', (data) => {
        let event
        try {
          event = JSON.parse(data.toString())
        } catch (error) {
          node.warn('Dirigera websocket: non-JSON message received')
          return
        }
        for (const listener of node.eventListeners) {
          try { listener.onWsEvent(event) } catch (_) {}
        }
      })
      ws.on('error', (error) => {
        node.warn('Dirigera websocket error: ' + error.message)
      })
      ws.on('close', () => {
        node.ws = null
        notifyStatus('disconnected')
        scheduleReconnect()
      })
    }

    function scheduleReconnect () {
      if (node.wsClosing || node.eventListeners.size === 0) return
      if (node.wsReconnectTimer) return
      node.wsReconnectTimer = setTimeout(() => {
        node.wsReconnectTimer = null
        startWebSocket()
      }, node.wsReconnectDelay)
      node.wsReconnectDelay = Math.min(node.wsReconnectDelay * 2, 60000)
    }

    function stopWebSocket () {
      node.wsClosing = true
      if (node.wsReconnectTimer) {
        clearTimeout(node.wsReconnectTimer)
        node.wsReconnectTimer = null
      }
      if (node.ws) {
        try { node.ws.terminate() } catch (_) {}
        node.ws = null
      }
    }

    node.registerEventListener = function (listener) {
      // Ein neuer Listener bedeutet: WebSocket soll laufen. Ein früheres
      // stopWebSocket() (letzter Listener entfernt) hatte wsClosing dauerhaft
      // gesetzt — hier zurücksetzen, sonst startet die Verbindung nie wieder.
      node.wsClosing = false
      node.eventListeners.add(listener)
      if (node.ws && node.ws.readyState === WebSocket.OPEN) {
        listener.onWsStatus('connected')
      } else {
        startWebSocket()
      }
    }

    node.deregisterEventListener = function (listener) {
      node.eventListeners.delete(listener)
      if (node.eventListeners.size === 0) stopWebSocket()
    }

    node.on('close', function (done) {
      stopWebSocket()
      done()
    })

    // --- REST client (unchanged) ---
    if (!node.credentials.hubAddress || !node.credentials.hubAccessCode) return
    const dirigeraHub = new DirigeraHub({ hubAddress: node.credentials.hubAddress, access_token: node.credentials.hubAccessCode, debug: 0 })
    dirigeraHub.logIn().then(() => {
      node.dirigeraClient = dirigeraHub
      node.lastError = ''
    }).catch((error) => {
      node.dirigeraClient = undefined
      node.error('Dirigera config error: ' + error)
      node.lastError = String(error) || ''
    })
  }
  RED.nodes.registerType('dirigera-config', DirigeraConfigNode, {
    credentials: {
      hubAddress: { type: 'text' },
      hubAccessCode: { type: 'text' }
    }
  })

  function DirigeraNode (config) {
    RED.nodes.createNode(this, config)
    const node = this
    this.config = config
    node.on('input', async function (msg, send, done) {
      node.server = RED.nodes.getNode(config.server)
      node.status({ fill: '', text: '' })
      try {
        if (!node.server || !node.server.dirigeraClient) {
          const lastError = node.server && node.server.lastError ? ': ' + node.server.lastError : ''
          throw new Error('Unknown config error' + lastError)
        }
        if (node.config.choiceId === -1) {
          throw new Error('Choices error in dropdowns or config error')
        }
        if (node.config.choiceType === 'scene') {
          await node.server.dirigeraClient.triggerScene(node.config.choiceId)
        } else if (node.config.choiceType === 'specificDevice') {
          let deviceId = node.config.choiceId
          if (node.config.choiceId === 'overrideDevice') {
            if (!msg.deviceId) throw new Error('No deviceId in msg.deviceId')
            deviceId = msg.deviceId
          }
          if (msg.topic) {
            msg.payload = await node.server.dirigeraClient.setDevice(deviceId, msg.topic, msg.payload)
          } else {
            msg.payload = await node.server.dirigeraClient.getDevice(deviceId)
            msg.availableTopics = msg.payload.capabilities.canReceive
          }
          send(msg)
        } else {
          let roomId = node.config.choiceId
          if (node.config.choiceId === 'overrideRoom') {
            if (!msg.roomId) throw new Error('No roomId in msg.roomId')
            roomId = msg.roomId
          }
          if (msg.topic) {
            msg.payload = await node.server.dirigeraClient.setRoom(roomId, msg.topic, msg.payload, node.config.choiceType)
            if (msg.payload.ok.length === 0 && msg.payload.errors.length > 0) throw new Error(msg.payload.errors[0])
          } else {
            msg.payload = await node.server.dirigeraClient.getRoom(roomId, node.config.choiceType)
            msg.availableTopics = msg.payload[0].capabilities.canReceive
          }
          send(msg)
        }
        done()
      } catch (error) {
        node.status({ fill: 'red', text: error.message || error })
        done(error.message || error)
      }
    })
  }
  RED.nodes.registerType('dirigera', DirigeraNode)

  function DirigeraEventsNode (config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.server = RED.nodes.getNode(config.server)
    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'no config' })
      return
    }

    const filterEventType = config.eventType || '' // '' = all
    const filterDeviceId = config.deviceId || '' // '' = all
    const filterDeviceType = config.deviceType || '' // '' = all

    const listener = {
      onWsStatus: function (status) {
        switch (status) {
          case 'connected':
            node.status({ fill: 'green', shape: 'dot', text: 'connected' })
            break
          case 'connecting':
            node.status({ fill: 'yellow', shape: 'ring', text: 'connecting' })
            break
          default:
            node.status({ fill: 'red', shape: 'ring', text: 'disconnected' })
        }
      },
      onWsEvent: function (event) {
        if (filterEventType && event.type !== filterEventType) return
        if (filterDeviceId && event.data?.id !== filterDeviceId) return
        if (filterDeviceType && event.data?.deviceType !== filterDeviceType && event.data?.type !== filterDeviceType) return
        node.send({
          topic: event.type || '',
          payload: event.data || event,
          event // full event incl. id, time, source
        })
      }
    }

    node.server.registerEventListener(listener)
    node.on('close', function (done) {
      node.server.deregisterEventListener(listener)
      done()
    })
  }
  RED.nodes.registerType('dirigera-events', DirigeraEventsNode)
}
