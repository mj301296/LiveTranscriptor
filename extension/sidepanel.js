import { RingBuffer } from './lib/ring-buffer.js';
import { fmtTime, expBackoff, download, copyToClipboard } from './lib/utils.js';

const ui = {
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  micToggle: document.getElementById('micToggle'),
  chunkMode: document.getElementById('chunkMode'),
  status: document.getElementById('status'),
  recDot: document.getElementById('recDot'),
  connDot: document.getElementById('connDot'),
  errText: document.getElementById('errText'),
  transcript: document.getElementById('transcript'),
  clock: document.getElementById('clock'),
  copyBtn: document.getElementById('copyBtn'),
  dlTxt: document.getElementById('downloadTxt'),
  dlJson: document.getElementById('downloadJson')
};

let mediaStreams = { tab: null, mic: null };
let audioCtx, workletNode, offlineBuffer;
let startTime = 0, timerId; 
let paused = false;
let attempt = 0;
let mode = 'stream'; // 'stream'|'chunk'
let ws, chunkTimer;
let transcriptLines = [];

ui.startBtn.onclick = start; ui.stopBtn.onclick = stop; ui.pauseBtn.onclick = togglePause;
ui.copyBtn.onclick = () => copyToClipboard(ui.transcript.textContent || '');
ui.dlTxt.onclick = () => download('transcript.txt', ui.transcript.textContent || '');
ui.dlJson.onclick = () => download('transcript.json', JSON.stringify({ lines: transcriptLines }, null, 2));
ui.chunkMode.onchange = () => { mode = ui.chunkMode.checked ? 'chunk' : 'stream'; setStatus(); };

setStatus('idle');

async function start() {
  attempt = 0; paused = false;
  mode = ui.chunkMode.checked ? 'chunk' : 'stream';
  setStatus('connecting');
  await ensureAudio();
  await startStreams();
  startTimer();
  if (mode === 'stream') connectWS();
  else startChunkLoop();
  ui.startBtn.disabled = true; ui.stopBtn.disabled = false; ui.pauseBtn.disabled = false;
}

async function stop() {
  stopTimer();
  await stopStreams();
  stopWS();
  stopChunkLoop();
  setStatus('idle');
  ui.startBtn.disabled = false; ui.stopBtn.disabled = true; ui.pauseBtn.disabled = true; ui.pauseBtn.textContent = 'Pause';
}

function togglePause(){
  paused = !paused;
  ui.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
}

function setStatus(s) {
  if (s) ui.status.textContent = s;
  ui.recDot.classList.toggle('on', !!mediaStreams.tab || !!mediaStreams.mic);
  ui.connDot.classList.toggle('ok', ws?.readyState === 1 || mode === 'chunk');
}

function startTimer(){
  startTime = performance.now();
  timerId = setInterval(()=>{ ui.clock.textContent = fmtTime(performance.now() - startTime); }, 500);
}
function stopTimer(){ clearInterval(timerId); }

async function ensureAudio(){
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    await audioCtx.audioWorklet.addModule('lib/audio-worklet-processor.js');
  }
}

async function startStreams(){
  // Capture tab audio
  mediaStreams.tab = await new Promise((resolve, reject) => {
    chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
      if (chrome.runtime.lastError || !stream) return reject(chrome.runtime.lastError || new Error('tabCapture failed'));
      resolve(stream);
    });
  });

  // Play tab audio for user
  const audioEl = document.createElement('audio');
  audioEl.srcObject = mediaStreams.tab;
  audioEl.autoplay = true;
  audioEl.muted = false;
  audioEl.volume = 1.0;
  document.body.appendChild(audioEl);

  // Capture mic audio if toggled
  if (ui.micToggle.checked) {
    mediaStreams.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  attachWorklet(mediaStreams);
}



async function stopStreams(){
for (const k of Object.keys(mediaStreams)){
  if (mediaStreams[k]) {
    mediaStreams[k].getTracks().forEach(t => t.stop());
    mediaStreams[k] = null;
  }
}
if (workletNode && workletNode.port) workletNode.port.onmessage = null;
if (workletNode) workletNode.disconnect();
}

function attachWorklet(streams){
  if (workletNode) workletNode.disconnect();
  const dest = audioCtx.createMediaStreamDestination(); // merge
  const sources = Object.entries(streams).filter(([,s])=>s).map(([,s])=>audioCtx.createMediaStreamSource(s));
  sources.forEach(src => src.connect(dest));

  workletNode = new AudioWorkletNode(audioCtx, 'downsampler');
  const destSource = audioCtx.createMediaStreamSource(dest.stream);
  destSource.connect(workletNode);

  offlineBuffer = new RingBuffer();
  workletNode.port.onmessage = (e)=>{
    if (paused) return;
    const pcm16 = new Uint8Array(e.data);
    offlineBuffer.push(pcm16);
    if (mode === 'stream') ws?.readyState === 1 && ws.send(pcm16);
  };
}

function connectWS(){
  const url = (localStorage.getItem('WS_URL') || 'ws://localhost:8787/stream');
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = ()=>{ attempt = 0; setStatus('streaming'); ui.errText.textContent = ''; };
  ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === "interim") {
      handleTranscript(msg.text, true);
    } else if (msg.type === "final") {
      handleTranscript(msg.text, false);
    }
  } catch {
    handleTranscript(ev.data, false); // fallback for plain text
  }
};

  ws.onerror = ()=> ui.errText.textContent = 'Network error';
  ws.onclose = ()=>{
    if (!mediaStreams.tab) return;
    if (attempt++ < 2) {
      const ms = expBackoff(attempt);
      setStatus(`reconnecting in ${Math.round(ms)}ms`);
      setTimeout(connectWS, ms);
    } else {
      mode = 'chunk'; ui.chunkMode.checked = true; startChunkLoop(); setStatus('chunking');
    }
  };
}

function stopWS(){ if (ws){ ws.onclose = null; ws.close(); ws = null; } }

function startChunkLoop(){
  if (chunkTimer) return;
  const intervalMs = 30000;
  chunkTimer = setInterval(async ()=>{
    if (paused || offlineBuffer.length === 0) return;
    const payload = offlineBuffer.toArray();
    await sendChunk(payload);
  }, intervalMs);
}
function stopChunkLoop(){ clearInterval(chunkTimer); chunkTimer = null; }

async function sendChunk(bytes){
  const url = (localStorage.getItem('CHUNK_URL') || 'http://localhost:8787/chunk');
  try{
    const res = await fetch(url, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!res.ok) throw new Error('Chunk upload failed');
    const data = await res.json();
    handleTranscript(data.text || '');
  }catch(e){
    ui.errText.textContent = 'Upload failed; queued offline';
  }
}

function handleTranscript(text, interim = false) {
  if (!text) return;
  const ts = fmtTime(performance.now() - startTime);

  if (interim) {
    // show only the latest interim line
    let interimDiv = document.getElementById("interim");
    if (!interimDiv) {
      interimDiv = document.createElement("div");
      interimDiv.id = "interim";
      interimDiv.style.color = "gray";
      interimDiv.style.fontStyle = "italic";
      ui.transcript.appendChild(interimDiv);
    }
    interimDiv.textContent = text;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
    return;
  }

  // final transcript
  const line = { ts, text };
  transcriptLines.push(line);

  const div = document.createElement("div");
  div.innerHTML = `<span class="ts">[${ts}]</span> ${escapeHtml(text)}`;
  ui.transcript.insertBefore(div, document.getElementById("interim"));
  ui.transcript.scrollTop = ui.transcript.scrollHeight;

  // clear interim after final lands
  const interimDiv = document.getElementById("interim");
  if (interimDiv) interimDiv.textContent = "";
}


function escapeHtml(str){ return str.replace(/[&<>\"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
