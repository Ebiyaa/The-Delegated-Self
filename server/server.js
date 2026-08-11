const fs = require('fs');
const path = require('path');
const { NFC } = require('nfc-pcsc');
const WebSocket = require('ws');

// ---- Config ---------------------------------------------------------

const PORT = 8080;
const USE_ARDUINO = true;
const ARDUINO_SERIAL_PATH = '/dev/tty.usbmodem11101'; // auto-detect fallback below
const ARDUINO_BAUD_RATE = 9600;

const CONFIG_DIR = path.join(__dirname, 'config');
const tagMap = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'tags.json'), 'utf8'));
const personas = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'personas.json'), 'utf8'));

// state -> single-char command the Arduino understands
const LED_COMMANDS = {
  idle: '0',
  sovereign: 'S',
  delegated: 'D',
  restricted: 'R',
};

// ---- Arduino serial (auto-detecting, self-healing) -------------------

let arduinoPort = null;
let arduinoRetryTimer = null;

const ARDUINO_VENDOR_IDS = ['2341', '2a03', '1a86', '0403'];

async function connectArduino() {
  if (!USE_ARDUINO) return;

  const { SerialPort } = require('serialport');
  const { ReadlineParser } = require('@serialport/parser-readline');

  let ports;
  try {
    ports = await SerialPort.list();
  } catch (err) {
    console.error('Could not list serial ports:', err.message);
    arduinoRetryTimer = setTimeout(connectArduino, 5000);
    return;
  }

  let target = ports.find((p) => p.path === ARDUINO_SERIAL_PATH);
  if (!target) {
    target = ports.find(
      (p) =>
        ARDUINO_VENDOR_IDS.includes((p.vendorId || '').toLowerCase()) ||
        /usbmodem|usbserial|wchusbserial/i.test(p.path)
    );
    if (target) {
      console.warn(
        `ARDUINO_SERIAL_PATH (${ARDUINO_SERIAL_PATH}) not found — using ${target.path}. ` +
        `Update the constant in server.js to silence this.`
      );
    }
  }

  if (!target) {
    console.error('No Arduino found. Plug it in — retrying in 5s...');
    arduinoRetryTimer = setTimeout(connectArduino, 5000);
    return;
  }

  arduinoPort = new SerialPort({ path: target.path, baudRate: ARDUINO_BAUD_RATE });
  const parser = arduinoPort.pipe(new ReadlineParser({ delimiter: '\n' }));

  arduinoPort.on('open', () => console.log(`Arduino connected on ${target.path}`));
  arduinoPort.on('error', (err) => console.error('Arduino serial error:', err.message));

  arduinoPort.on('close', () => {
    console.warn('Arduino disconnected — retrying in 5s...');
    arduinoPort = null;
    clearTimeout(arduinoRetryTimer);
    arduinoRetryTimer = setTimeout(connectArduino, 5000);
  });

  parser.on('data', (line) => handleArduinoLine(line.trim()));
}

function sendToArduino(cmd) {
  if (!arduinoPort || !arduinoPort.isOpen) return;
  arduinoPort.write(cmd);
}

function setLedState(state) {
  sendToArduino(LED_COMMANDS[state] || LED_COMMANDS.idle);
}

// ---- Interpreting what the Arduino says ------------------------------

function handleArduinoLine(line) {
  if (!line) return;

  // "SENS:<ring>,<palm>" — either pad's occupancy changed
  if (line.startsWith('SENS:')) {
    const [ring, palm] = line.slice(5).split(',').map((n) => n.trim() === '1');
    console.log(`Pads — ring: ${ring ? 'OK' : 'waiting'}, palm: ${palm ? 'OK' : 'waiting'}`);
    broadcast({ type: 'sensors', ring, palm });
    return;
  }

  // "BOTH:1" — both pads satisfied, biometric gate passes
  if (line.startsWith('BOTH:')) {
    console.log('Both pads confirmed — advancing to persona choice.');
    broadcast({ type: 'biometric-ok' });
    return;
  }

  // "BTN:1" — pinball button pressed
  if (line.startsWith('BTN:')) {
    console.log('Pinball button pressed.');
    broadcast({ type: 'button' });
    return;
  }

  // "TEMP:x,y" only appears when DEBUG_TEMPS is on in the sketch
  if (line.startsWith('TEMP:')) {
    console.log(`[calibration] ${line}`);
    return;
  }
}

// ---- WebSocket -------------------------------------------------------

const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server listening on ws://localhost:${PORT}`);

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('Browser client connected.');
  ws.send(JSON.stringify({ type: 'status', ready: true, personas }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // Tag video finished — time to ask for the ring and palm.
      case 'begin-biometric':
        console.log('Tag video finished — pads now live.');
        sendToArduino('B');
        break;

      // Interaction over (or reset) — pads go dark, strip back to idle.
      case 'end-biometric':
        sendToArduino('E');
        break;

      case 'reset':
        console.log('Interaction reset — back to idle.');
        sendToArduino('E');
        setLedState('idle');
        break;

      default:
        break;
    }
  });
});

// ---- NFC reader ------------------------------------------------------

const nfc = new NFC();

nfc.on('reader', (reader) => {
  console.log(`Reader attached: ${reader.reader.name}`);
  broadcast({ type: 'status', ready: true, personas });

  reader.on('card', (card) => {
    const uid = card.uid;
    const entry = tagMap[uid];

    if (!entry) {
      console.warn(`Unknown tag scanned: ${uid} (not in tags.json)`);
      broadcast({ type: 'unknown', uid });
      return;
    }

    console.log(`Tag matched: ${uid} -> ${entry.state} (${entry.interventionOutcome} on intervention)`);
    broadcast({ type: 'scan', uid, ...entry });

    // The Arduino holds this color for exactly 10s on its own, then
    // returns to breathing blue — independent of how long the video runs.
    setLedState(entry.state);
  });

  reader.on('card.off', () => {
    console.log('Tag lifted — interaction continues.');
  });

  reader.on('error', (err) => console.error('Reader error:', err.message));
  reader.on('end', () => console.log(`Reader detached: ${reader.reader.name}`));
});

nfc.on('error', (err) => {
  console.error('NFC init error:', err.message);
  console.error('Check the ACR122U driver install and that the reader is plugged in.');
});

connectArduino();
