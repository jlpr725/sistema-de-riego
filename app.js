// Nordic UART Service - mismo servicio que expone el bloque "Bluetooth" de MakeCode
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // la app escribe aca (RX de la microbit)
const UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // la app escucha aca (TX de la microbit)

const HISTORY_KEY = 'riego_history_v1';
const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas
const HISTORY_MAX_POINTS = 4000; // tope de seguridad, se decima si se supera
const HISTORY_SAVE_INTERVAL_MS = 10000; // no escribir a localStorage en cada lectura

const el = (id) => document.getElementById(id);

const ui = {
  connectCard: el('connectCard'),
  connectTitle: el('connectTitle'),
  connectSubtitle: el('connectSubtitle'),
  subtitle: el('subtitle'),
  unsupportedMsg: el('unsupportedMsg'),
  connectionError: el('connectionError'),
  tempVal: el('tempVal'),
  humVal: el('humVal'),
  ecVal: el('ecVal'),
  soilVal: el('soilVal'),
  quickActionTitle: el('quickActionTitle'),
  quickActionSubtitle: el('quickActionSubtitle'),
  modeToggle: el('modeToggle'),
  pumpBtn: el('pumpBtn'),
  lastUpdate: el('lastUpdate'),
  historyBtn: el('historyBtn'),
  historyBackBtn: el('historyBackBtn'),
  historyView: el('historyView'),
  historyEmpty: el('historyEmpty'),
  historyBody: el('historyBody'),
  historyCharts: el('historyCharts'),
  historyTableBody: el('historyTableBody'),
  historyNote: el('historyNote'),
  exportCsvBtn: el('exportCsvBtn'),
  exportXlsxBtn: el('exportXlsxBtn'),
  clearHistoryBtn: el('clearHistoryBtn'),
};

let device = null;
let rxChar = null; // characteristic to write commands to
let txChar = null; // characteristic to read notifications from
let rxBuffer = '';
let isAutoMode = false; // estado real reportado por la microbit
let isConnected = false;

// ---------- Historial ----------
let history = loadHistory();
let historySaveTimer = null;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return pruneHistory(Array.isArray(arr) ? arr : []);
  } catch (e) {
    console.warn('No se pudo leer el historial guardado:', e);
    return [];
  }
}

function pruneHistory(arr) {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  return arr.filter((r) => r.t >= cutoff);
}

function decimateIfNeeded(arr) {
  if (arr.length <= HISTORY_MAX_POINTS) return arr;
  // conserva 1 de cada 2 puntos para no perder la forma de la curva
  return arr.filter((_, i) => i % 2 === 0);
}

function scheduleHistorySave() {
  if (historySaveTimer) return;
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('No se pudo guardar el historial:', e);
    }
  }, HISTORY_SAVE_INTERVAL_MS);
}

function appendHistoryRecord(record) {
  history.push(record);
  history = pruneHistory(history);
  history = decimateIfNeeded(history);
  scheduleHistorySave();
  if (!ui.historyView.classList.contains('hidden')) {
    renderHistoryView();
  }
}

function flushHistorySaveNow() {
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer = null;
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn('No se pudo guardar el historial:', e);
  }
}

// ---------- UI de conexion ----------
function setConnectionUI(state) {
  // state: 'disconnected' | 'connecting' | 'connected'
  ui.connectCard.classList.toggle('connecting', state === 'connecting');
  ui.connectCard.classList.toggle('connected', state === 'connected');
  isConnected = state === 'connected';

  if (state === 'connected') {
    ui.connectTitle.textContent = 'Dispositivo conectado';
    ui.connectSubtitle.textContent = (device && device.name) || 'micro:bit';
    ui.subtitle.textContent = `Conectado a ${(device && device.name) || 'micro:bit'}`;
  } else if (state === 'connecting') {
    ui.connectTitle.textContent = 'Conectando...';
    ui.connectSubtitle.textContent = 'Buscá tu micro:bit en la lista';
    ui.subtitle.textContent = 'Control por micro:bit \u00b7 Bluetooth';
  } else {
    ui.connectTitle.textContent = 'Conectar dispositivo';
    ui.connectSubtitle.textContent = 'Escanear dispositivos BLE microbit';
    ui.subtitle.textContent = 'Control por micro:bit \u00b7 Bluetooth';
  }

  ui.modeToggle.disabled = state !== 'connected';

  if (state !== 'disconnected') {
    ui.connectionError.classList.add('hidden');
  }

  if (state !== 'connected') {
    ui.pumpBtn.disabled = true;
    ui.pumpBtn.classList.remove('manual', 'on');
    ui.modeToggle.classList.remove('on');
    ui.modeToggle.setAttribute('aria-checked', 'false');
    ui.quickActionTitle.textContent = 'Tipo de Riego';
    ui.quickActionSubtitle.textContent = 'Modo Autom\u00e1tico';
  }
}

// al pasar el mouse o enfocar la card conectada, avisar que un click desconecta
function showDisconnectHint() {
  if (ui.connectCard.classList.contains('connected')) {
    ui.connectSubtitle.textContent = 'Tocar para desconectar';
  }
}
function showConnectedLabel() {
  if (ui.connectCard.classList.contains('connected')) {
    ui.connectSubtitle.textContent = (device && device.name) || 'micro:bit';
  }
}
ui.connectCard.addEventListener('mouseenter', showDisconnectHint);
ui.connectCard.addEventListener('mouseleave', showConnectedLabel);
ui.connectCard.addEventListener('focus', showDisconnectHint);
ui.connectCard.addEventListener('blur', showConnectedLabel);

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
    // "NotFoundError" pasa cuando el usuario cierra el selector de dispositivos sin elegir uno;
    // en ese caso no mostramos error, fue una cancelación normal.
    if (err && err.name !== 'NotFoundError') {
      ui.connectionError.textContent = `No se pudo conectar: ${err.message || err.name || 'error desconocido'}. Revisá que el Bluetooth esté activo y que la microbit tenga el programa BLE UART cargado, y volvé a intentar.`;
      ui.connectionError.classList.remove('hidden');
    }
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
  flushHistorySaveNow();
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

  const [temp, hum, soil, ec, pump, mode] = parts.map(Number);
  if ([temp, hum, soil, ec, pump, mode].some((v) => Number.isNaN(v))) return;

  ui.tempVal.textContent = temp;
  ui.humVal.textContent = hum;
  ui.ecVal.textContent = ec;
  ui.soilVal.textContent = soil;

  isAutoMode = mode === 1; // protocolo: 0 = manual, 1 = automatico
  const pumpOn = pump === 1;

  ui.modeToggle.classList.toggle('on', !isAutoMode);
  ui.modeToggle.setAttribute('aria-checked', String(!isAutoMode));

  ui.pumpBtn.disabled = isAutoMode || !isConnected;
  ui.pumpBtn.classList.toggle('manual', !isAutoMode);
  ui.pumpBtn.classList.toggle('on', !isAutoMode && pumpOn);

  if (isAutoMode) {
    ui.quickActionTitle.textContent = 'Tipo de Riego';
    ui.quickActionSubtitle.textContent = 'Modo Autom\u00e1tico';
  } else {
    ui.quickActionTitle.textContent = 'Activar Riego';
    ui.quickActionSubtitle.textContent = pumpOn ? 'Regando (Modo Manual)' : 'Modo Manual';
  }

  ui.lastUpdate.textContent = `\u00daltima lectura: ${new Date().toLocaleTimeString()}`;

  appendHistoryRecord({
    t: Date.now(),
    temp, hum, soil, ec,
    pump: pumpOn ? 1 : 0,
    mode: isAutoMode ? 1 : 0,
  });
}

async function sendCommand(cmd) {
  if (!rxChar) return;
  try {
    await rxChar.writeValue(new TextEncoder().encode(cmd + '\n'));
  } catch (err) {
    console.error('Error enviando comando:', err);
  }
}

ui.connectCard.addEventListener('click', () => {
  if (device && device.gatt.connected) {
    disconnect();
  } else {
    connect();
  }
});

ui.pumpBtn.addEventListener('click', () => {
  if (isAutoMode || !isConnected) return;
  const turningOn = !ui.pumpBtn.classList.contains('on');
  sendCommand(turningOn ? 'bon' : 'boff');
});

// El toggle cambia entre modo Automatico (apagado) y Manual (encendido)
ui.modeToggle.addEventListener('click', () => {
  if (!isConnected) return;
  sendCommand(isAutoMode ? 'aoff' : 'aon');
});

// ---------- Historial: vista, graficas, tabla, export ----------
function openHistoryView() {
  renderHistoryView();
  ui.historyView.classList.remove('hidden');
}
function closeHistoryView() {
  ui.historyView.classList.add('hidden');
}
ui.historyBtn.addEventListener('click', openHistoryView);
ui.historyBackBtn.addEventListener('click', closeHistoryView);

function lineChartSVG(points, key, color) {
  const w = 600, h = 110, pad = 8;
  if (!points.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const vals = points.map((p) => p[key]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = (max - min) || 1;
  const stepX = points.length > 1 ? (w - 2 * pad) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((p[key] - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${coords}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function renderHistoryView() {
  if (!history.length) {
    ui.historyEmpty.classList.remove('hidden');
    ui.historyBody.classList.add('hidden');
    return;
  }
  ui.historyEmpty.classList.add('hidden');
  ui.historyBody.classList.remove('hidden');

  const sorted = [...history].sort((a, b) => a.t - b.t);

  const charts = [
    { key: 'temp', label: 'Temperatura (\u00b0C)', color: '#ef5a5a' },
    { key: 'hum', label: 'Humedad ambiente (%)', color: '#4a56d6' },
    { key: 'soil', label: 'Humedad de suelo (%)', color: '#43a047' },
  ];

  ui.historyCharts.innerHTML = charts.map((c) => {
    const vals = sorted.map((p) => p[c.key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return `
      <div class="chart-card">
        <h3>${c.label}</h3>
        ${lineChartSVG(sorted, c.key, c.color)}
        <div class="chart-minmax"><span>M\u00edn ${min}</span><span>M\u00e1x ${max}</span></div>
      </div>`;
  }).join('');

  const MAX_ROWS = 500;
  const rows = sorted.slice(-MAX_ROWS).reverse();
  ui.historyNote.textContent = sorted.length > MAX_ROWS
    ? `Mostrando las \u00faltimas ${MAX_ROWS} lecturas de ${sorted.length} guardadas. La exportaci\u00f3n incluye todas.`
    : `${sorted.length} lecturas guardadas en las \u00faltimas 24 horas.`;

  ui.historyTableBody.innerHTML = rows.map((r) => `
    <tr>
      <td>${new Date(r.t).toLocaleTimeString()}</td>
      <td>${r.temp}</td>
      <td>${r.hum}</td>
      <td>${r.soil}</td>
      <td>${r.ec}</td>
      <td>${r.pump ? 'ON' : 'OFF'}</td>
      <td>${r.mode ? 'Auto' : 'Manual'}</td>
    </tr>`).join('');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function historyToRows() {
  const sorted = [...history].sort((a, b) => a.t - b.t);
  return sorted.map((r) => ({
    Fecha: new Date(r.t).toLocaleDateString(),
    Hora: new Date(r.t).toLocaleTimeString(),
    'Temperatura (\u00b0C)': r.temp,
    'Humedad (%)': r.hum,
    'Humedad suelo (%)': r.soil,
    'Conductividad': r.ec,
    'Bomba': r.pump ? 'ON' : 'OFF',
    'Modo': r.mode ? 'Auto' : 'Manual',
  }));
}

ui.exportCsvBtn.addEventListener('click', () => {
  if (!history.length) return;
  const rows = historyToRows();
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(',')),
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `historial_riego_${Date.now()}.csv`);
});

let sheetJsLoading = null;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  if (sheetJsLoading) return sheetJsLoading;
  sheetJsLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar el generador de Excel'));
    document.head.appendChild(script);
  });
  return sheetJsLoading;
}

ui.exportXlsxBtn.addEventListener('click', async () => {
  if (!history.length) return;
  try {
    await loadSheetJS();
    const rows = historyToRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial');
    XLSX.writeFile(wb, `historial_riego_${Date.now()}.xlsx`);
  } catch (err) {
    console.error(err);
    alert('No se pudo generar el Excel (sin conexi\u00f3n la primera vez). Prob\u00e1 exportar en CSV mientras tanto.');
  }
});

ui.clearHistoryBtn.addEventListener('click', () => {
  if (!history.length) return;
  const ok = window.confirm('¿Borrar todo el historial guardado en este dispositivo? Esta acción no se puede deshacer.');
  if (!ok) return;
  history = [];
  flushHistorySaveNow();
  renderHistoryView();
});

// ---------- Init ----------
setConnectionUI('disconnected');

if (!navigator.bluetooth) {
  ui.unsupportedMsg.classList.remove('hidden');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW no registrado:', e));
  });
}

window.addEventListener('beforeunload', flushHistorySaveNow);
