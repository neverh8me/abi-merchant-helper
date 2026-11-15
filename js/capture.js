// ABI: Merchant Helper — Game sound and screen from the app (or the browser).
// Plain script (no modules): all files share one global scope; index.html loads them in order.
'use strict';

// ---------- Capture ----------
const WORKLET_SRC = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${TAP_BLOCK}); this.n = 0; }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const ch0 = inp[0], ch1 = inp[1] || inp[0];
    for (let i = 0; i < ch0.length; i++) {
      this.buf[this.n++] = (ch0[i] + ch1[i]) * 0.5;
      if (this.n === ${TAP_BLOCK}) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('tap', Tap);`;

async function start() {
  beepCtx = beepCtx || new AudioContext(); // created during the click so the browser does not block the sound
  if (typeof Ocr !== 'undefined') Ocr.start().catch(() => {}); // text readers start in advance, in the background
  if (mode === 'overlay') openOverlay(); // needs this click, so before any await
  // The local server (start.bat) provides the game-only sound and the screen capture, no browser sharing.
  // Without it: browser screen sharing and all PC sound.
  gameWs = await connectGameAudio();
  screenWs = gameWs ? await connectScreen() : null;
  if (screenWs) {
    stream = { getTracks: () => [] }; // the screen comes from the server, there is no browser stream
    startNativeScreen();
  } else {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(gameWs
        ? { video: { frameRate: 15 }, audio: false }
        : {
          video: { frameRate: 15 },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: 'include',
        });
    } catch (e) {
      closeGameAudio();
      setStatus(tr('status.cancelled', { msg: e.message }));
      return;
    }
    if (!gameWs && !stream.getAudioTracks().length) {
      setStatus(tr('status.noAudio'));
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      return;
    }
    stream.getTracks().forEach(t => t.addEventListener('ended', stop));
    startVideo(stream.getVideoTracks()[0]);
  }

  detector = Ear.makeStream({
    sens: () => +ui.sens.value,
    muted: () => performance.now() < muteUntil,
    onWindow,
    onRaw,
    onLevel: (db, trig) => {
      if (trig) captureOnset = performance.now();
      if (document.visibilityState === 'visible') drawLevel(db, trig);
    },
  });

  if (gameWs) {
    wireGameAudio();
    showGameStatus(gameStatus);
  } else {
    // the same rate as the library, so the samples match exactly
    audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: Ear.SAMPLE_RATE });
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await audioCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    srcNode = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    workletNode = new AudioWorkletNode(audioCtx, 'tap', { numberOfOutputs: 0 });
    workletNode.port.onmessage = e => detector.push(e.data);
    srcNode.connect(workletNode);
    setStatus(tr('status.listenAll', { rate: audioCtx.sampleRate }));
  }

  ui.start.disabled = true; ui.stop.disabled = false;
  log(tr('log.started', { audio: tr(gameWs ? 'log.audioGame' : 'log.audioAll'), screen: tr(screenWs ? 'log.screenServer' : 'log.screenBrowser') }));
  resetScan();
}

// Connects to the game sound from the local server. Returns a WebSocket or null if there is no server.
// Game sound from the local server. If the connection drops (the server restarted, the PC slept), it is
// re-opened every RECONNECT_MS while catching is on, instead of staying silent until a restart.
function wireGameAudio() {
  gameWs.onmessage = e => {
    if (typeof e.data === 'string') showGameStatus(JSON.parse(e.data));
    else if (detector) detector.push(new Float32Array(e.data));
  };
  gameWs.onclose = () => {
    if (!stream) return;
    gameWs = null;
    setStatus(tr('status.audioClosed'));
    setTimeout(reconnectAudio, RECONNECT_MS);
  };
}
async function reconnectAudio() {
  if (!stream || gameWs) return;
  const ws = await connectGameAudio();
  if (!stream) { if (ws) ws.close(); return; }
  if (!ws) { setTimeout(reconnectAudio, RECONNECT_MS); return; }
  gameWs = ws;
  wireGameAudio();
  showGameStatus(gameStatus);
  log(tr('log.reconnected'));
}
async function reconnectScreen() {
  if (!stream || screenWs) return;
  const ws = await connectScreen();
  if (!stream) { if (ws) ws.close(); return; }
  if (!ws) { setTimeout(reconnectScreen, RECONNECT_MS); return; }
  screenWs = ws;
  startNativeScreen();
}

function connectGameAudio() {
  if (!/^https?:$/.test(location.protocol)) return Promise.resolve(null);
  return new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(`ws://${location.host}/audio`); } catch { resolve(null); return; }
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => { ws.close(); resolve(null); }, 1500);
    ws.onmessage = e => {
      if (typeof e.data !== 'string') return;
      clearTimeout(timer);
      gameStatus = JSON.parse(e.data);
      ws.onmessage = null;
      resolve(ws);
    };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

function closeGameAudio() {
  if (!gameWs) return;
  const ws = gameWs;
  gameWs = null;
  ws.onclose = null;
  ws.close();
}

// Screen frames from the server (JPEG). Returns a WebSocket or null.
function connectScreen() {
  return new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(`ws://${location.host}/screen`); } catch { resolve(null); return; }
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => { ws.close(); resolve(null); }, 1500);
    ws.onopen = () => { clearTimeout(timer); resolve(ws); };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

function startNativeScreen() {
  let busy = false; // new frames are skipped while the previous one is parsed, so no delay builds up
  screenWs.onmessage = e => {
    if (typeof e.data === 'string') {
      const m = JSON.parse(e.data);
      if (m.type === 'cursor') { onCursor(m.x, m.y); return; }
      if (m.type !== 'screen') return;
      // only a message that tells the crop changes it: the black-screen one from older servers has no crop, and
      // reading it as "not cropped" cut the frame in half once more, leaving only the right columns of the list
      if ('crop' in m && !!m.crop !== frameCropped) { frameCropped = !!m.crop; if (P) resetScan(); }
      if (m.black) report('warning', tr('log.black'));
      if (m.state === 'nogame') report('warning', tr('log.nogame'));
      else if (m.state === 'minimized') report('warning', tr('log.minimized'));
      else if (m.state === 'game') log(tr('log.gameWin'));
      return;
    }
    if (busy) return;
    busy = true;
    createImageBitmap(new Blob([e.data], { type: 'image/jpeg' }))
      .then(bmp => { try { onVideoFrame(bmp, bmp.width, bmp.height); } finally { bmp.close(); } })
      .catch(() => {})
      .finally(() => { busy = false; });
  };
  screenWs.onclose = () => { if (stream) { screenWs = null; report('error', tr('log.screenClosed')); setTimeout(reconnectScreen, RECONNECT_MS); } };
}

function closeScreen() {
  if (!screenWs) return;
  const ws = screenWs;
  screenWs = null;
  ws.onclose = null;
  ws.close();
}

function showGameStatus(st) {
  gameStatus = st;
  if (!stream || !st) return;
  if (st.state === 'game') setStatus(tr('status.game'));
  else if (st.state === 'wait') setStatus(tr('status.wait'));
  else if (st.state === 'error') setStatus(tr('status.error', { msg: st.message }));
}

function stop() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  closeGameAudio();
  closeScreen();
  if (audioCtx) audioCtx.close();
  audioCtx = null; workletNode = null; srcNode = null; detector = null;
  if (videoReader) videoReader.cancel().catch(() => {});
  videoReader = null;
  clearInterval(videoTimer);
  ui.video.srcObject = null;
  ui.start.disabled = false; ui.stop.disabled = true;
  setRecording(null);
  setStatus(tr('status.stopped'));
  updateStage();
}
