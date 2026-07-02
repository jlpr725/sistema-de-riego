// Nordic UART Service - mismo servicio que expone el bloque "Bluetooth" de MakeCode
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // la app escribe aca (RX de la microbit)
const UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // la app escucha aca (TX de la microbit)

const el = (id) => document.getElementById(id);

const ui = {
  connectBtn: el('connectBtn'),
  connectLabel: el('connectLabel'),
  statusDot: el('statusDot'),
  subtitle: el('subtitle'),
  unsupportedMsg: el('unsupportedMsg'),
  tempVal: el('tempVal'),
  humVal: el('humVal'),
  ecVal: el('ecVal'),
  soilVal: el('soilVal'),
  soilFill: el('soilFill'),
  soilThresholdMark: el('soilThresholdMark'),
  thresholdInput: el('thresholdInput'),
  thresholdSaveBtn: el('thresholdSaveBtn'),
  manualBtn: el('manualBtn'),
  autoBtn: el('autoBtn'),
  pumpBtn: el('pumpBtn'),
  pumpBtnLabel: el('pumpBtnLabel'),
  pumpHint: el('pumpHint'),
  lastUpdate: el('lastUpdate'),
};

let device = null;
let rxChar = null; // characteristic to write commands to
let txChar = null; // characteristic to read notifications from
let rxBuffer = '';
let isAutoMode = false;

function setConnectionUI(state) {
  // state: 'disconnected' | 'connecting' | 'connected'
  ui.statusDot.className = 'status-dot' + (state === 'connected' ? ' connected' : state === 'connecting' ? ' connecting' : '');
  ui.connectBtn.classList.toggle('connected', state === 'connected');

  if (state === 'connected') {
    ui.connectLabel.textContent = 'Conectado';
    ui.subtitle.textContent = `Conectado a ${(device && device.name) || 'micro:bit'}`;
  } else if (state === 'connecting') {
    ui.connectLabel.textContent = 'Conectando...';
    ui.subtitle.textContent = 'Control por micro:bit \u00b7 Bluetooth';
  } else {
    ui.connectLabel.textContent = 'Conectar';
    ui.subtitle.textContent = 'Control por micro:bit \u00b7 Bluetooth';
  }

  ui.pumpBtn.disabled = state !== 'connected' || isAutoMode;
  ui.manualBtn.disabled = state !== 'connected';
  ui.autoBtn.disabled = state !== 'connected';
  ui.thresholdSaveBtn.disabled = state !== 'connected';
  if (state !== 'connected') {
    ui.pumpHint.textContent = 'Desconectado';
  }
}

// Mientras esta conectado, mostrar "Desconectar" solo al pasar el mouse o enfocar el boton,
// para dejar claro que hacer click desconecta, sin perder la confirmacion visual de "Conectado"
function showDisconnectHint() {
  if (ui.connectBtn.classList.contains('connected')) {
    ui.connectLabel.textContent = 'Desconectar';
  }
}
function showConnectedLabel() {
  if (ui.connectBtn.classList.contains('connected')) {
    ui.connectLabel.textContent = 'Conectado';
  }
}
ui.connectBtn.addEventListener('mouseenter', showDisconnectHint);
ui.connectBtn.addEventListener('mouseleave', showConnectedLabel);
ui.connectBtn.addEventListener('focus', showDisconnectHint);
ui.connectBtn.addEventListener('blur', showConnectedLabel);

async function connect() {
  if (!navigator.bluetooth) {
    ui.unsupportedMsg.classList.remove('hidden');
    return;
  }
  try {
    setConnectionUI('connecting');
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'BBC micro:bit' }],
      optionalServices: [UART_SERVICE],
    });
    device.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE);
    rxChar = await service.getCharacteristic(UART_RX_CHAR);
    txChar = await service.getCharacteristic(UART_TX_CHAR);

    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', onData);

    setConnectionUI('connected');
  } catch (err) {
    console.error('Error de conexion:', err);
    setConnectionUI('disconnected');
  }
}

function disconnect() {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  } else {
    onDisconnected();
  }
}

function onDisconnected() {
  rxChar = null;
  txChar = null;
  rxBuffer = '';
  setConnectionUI('disconnected');
}

function onData(event) {
  const chunk = new TextDecoder().decode(event.target.value);
  rxBuffer += chunk;

  let newlineIndex;
  while ((newlineIndex = rxBuffer.indexOf('\n')) >= 0) {
    const line = rxBuffer.slice(0, newlineIndex).trim();
    rxBuffer = rxBuffer.slice(newlineIndex + 1);
    if (line) handleLine(line);
  }
}

// Formato esperado desde la microbit:
// temperatura,humedad_ambiente,humedad_suelo,conductividad,bomba,modo,umbral
// bomba: 0/1  |  modo: 0=manual 1=automatico  |  umbral: 0-100 (opcional)
function handleLine(line) {
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 6) return;

  const [temp, hum, soil, ec, pump, mode, threshold] = parts.map(Number);
  if ([temp, hum, soil, ec, pump, mode].some((v) => Number.isNaN(v))) return;

  ui.tempVal.textContent = temp;
  ui.humVal.textContent = hum;
  ui.ecVal.textContent = ec;
  ui.soilVal.textContent = soil;
  ui.soilFill.style.height = `${Math.max(0, Math.min(100, soil))}%`;

  if (!Number.isNaN(threshold)) {
    ui.soilThresholdMark.style.bottom = `${Math.max(0, Math.min(100, threshold))}%`;
    // No pisar el valor mientras el usuario esta escribiendo uno nuevo
    if (document.activeElement !== ui.thresholdInput) {
      ui.thresholdInput.value = threshold;
    }
  }

  isAutoMode = mode === 1;
  ui.manualBtn.classList.toggle('active', !isAutoMode);
  ui.autoBtn.classList.toggle('active', isAutoMode);
  ui.pumpBtn.disabled = isAutoMode || !(device && device.gatt.connected);

  const pumpOn = pump === 1;
  ui.pumpBtn.classList.toggle('on', pumpOn);
  ui.pumpBtnLabel.textContent = pumpOn ? 'Apagar' : 'Encender';
  ui.pumpHint.textContent = isAutoMode
    ? (pumpOn ? 'Regando automaticamente' : 'En espera (automatico)')
    : (pumpOn ? 'Encendida manualmente' : 'Apagada');

  ui.lastUpdate.textContent = `Ultima lectura: ${new Date().toLocaleTimeString()}`;
}

async function sendCommand(cmd) {
  if (!rxChar) return;
  try {
    await rxChar.writeValue(new TextEncoder().encode(cmd + '\n'));
  } catch (err) {
    console.error('Error enviando comando:', err);
  }
}

ui.connectBtn.addEventListener('click', () => {
  if (device && device.gatt.connected) {
    disconnect();
  } else {
    connect();
  }
});

ui.pumpBtn.addEventListener('click', () => {
  const turningOn = !ui.pumpBtn.classList.contains('on');
  sendCommand(turningOn ? 'bon' : 'boff');
});

ui.manualBtn.addEventListener('click', () => sendCommand('aoff'));
ui.autoBtn.addEventListener('click', () => sendCommand('aon'));

ui.thresholdSaveBtn.addEventListener('click', () => {
  const value = Math.round(Number(ui.thresholdInput.value));
  if (Number.isNaN(value) || value < 0 || value > 100) return;
  sendCommand(`thr${value}`);
});

setConnectionUI('disconnected');

if (!navigator.bluetooth) {
  ui.unsupportedMsg.classList.remove('hidden');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW no registrado:', e));
  });
}
