// In-browser Wake Word Detector (ONNX Runtime Web)
//
// Runs the full openWakeWord inference pipeline locally:
//   PCM 16kHz → melspectrogram.onnx → embedding_model.onnx → kiki.onnx
//
// Exported interface:
//   initWakeWord(onDetected), destroyWakeWord()

/* global ort */

let _audioCtx = null;
let _sourceNode = null;
let _processorNode = null;
let _stream = null;
let _callback = null;
let _active = false;
let _engine = null;
let _processQueue = [];
let _processing = false;

const BUFFER_SIZE = 4096;
const THRESHOLD = 0.15;
const DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// Pipeline constants (match Python openwakeword exactly)
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 1280;    // 80ms at 16kHz — one processing unit
const MEL_CONTEXT = 480;    // 160*3 extra samples for STFT edge effects
const MEL_WINDOW = 76;      // mel frames consumed by embedding model
const MEL_STEP = 8;         // mel frame stride between embeddings
const MEL_MAX_LEN = 970;    // ~10s of mel history
const EMB_MAX_LEN = 120;    // ~10s of embedding history
const RAW_MAX_LEN = 160000; // 10s * 16kHz
const WARMUP_FRAMES = 5;    // skip first N classification frames
const CLS_INPUT_FRAMES = 16; // kiki.onnx expects (1, 16, 96)

// ---------------------------------------------------------------------------
// ONNX Inference Engine
// ---------------------------------------------------------------------------

class WakeWordEngine {
  constructor() {
    this.melSession = null;
    this.embSession = null;
    this.clsSession = null;

    this.rawBuffer = [];
    this.melBuffer = [];
    this.embBuffer = [];
    this.accumulated = 0;
    this.remainder = null;
    this.frameCount = 0;
    this.lastDetection = 0;
  }

  async init() {
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('offscreen/ort/');
    ort.env.wasm.numThreads = 1;

    const base = chrome.runtime.getURL('offscreen/models/');
    const opts = { executionProviders: ['wasm'] };

    this.melSession = await ort.InferenceSession.create(base + 'melspectrogram.onnx', opts);
    this.embSession = await ort.InferenceSession.create(base + 'embedding_model.onnx', opts);
    this.clsSession = await ort.InferenceSession.create(base + 'kiki.onnx', opts);

    this._resetBuffers();
  }

  _resetBuffers() {
    this.rawBuffer = [];
    this.accumulated = 0;
    this.remainder = null;
    this.frameCount = 0;

    this.melBuffer = [];
    for (let i = 0; i < MEL_WINDOW; i++) {
      this.melBuffer.push(new Float32Array(32).fill(1.0));
    }

    this.embBuffer = [];
  }

  async processAudio(int16) {
    let samples = int16;
    if (this.remainder && this.remainder.length > 0) {
      const merged = new Int16Array(this.remainder.length + int16.length);
      merged.set(this.remainder);
      merged.set(int16, this.remainder.length);
      samples = merged;
      this.remainder = null;
    }

    const totalPending = this.accumulated + samples.length;

    if (totalPending < CHUNK_SIZE) {
      this._pushRaw(samples, 0, samples.length);
      this.accumulated += samples.length;
      return 0;
    }

    const remainderLen = totalPending % CHUNK_SIZE;
    let processEnd = samples.length;
    if (remainderLen > 0) {
      processEnd = samples.length - remainderLen;
      this.remainder = new Int16Array(samples.buffer, samples.byteOffset + processEnd * 2, remainderLen);
      this.remainder = new Int16Array(this.remainder);
    }

    this._pushRaw(samples, 0, processEnd);
    this.accumulated += processEnd;

    if (this.rawBuffer.length > RAW_MAX_LEN) {
      this.rawBuffer = this.rawBuffer.slice(-RAW_MAX_LEN);
    }

    const nChunks = this.accumulated / CHUNK_SIZE;

    await this._streamMel(this.accumulated);

    for (let i = nChunks - 1; i >= 0; i--) {
      const offset = -MEL_STEP * i;
      const end = offset === 0 ? this.melBuffer.length : this.melBuffer.length + offset;
      const start = end - MEL_WINDOW;

      if (start >= 0 && end <= this.melBuffer.length) {
        const window = this.melBuffer.slice(start, end);
        if (window.length === MEL_WINDOW) {
          const emb = await this._embedding(window);
          this.embBuffer.push(emb);
        }
      }
    }

    if (this.embBuffer.length > EMB_MAX_LEN) {
      this.embBuffer = this.embBuffer.slice(-EMB_MAX_LEN);
    }

    const score = await this._classifyMulti(nChunks);
    this.accumulated = 0;
    this.frameCount++;

    return score;
  }

  _pushRaw(arr, from, to) {
    for (let i = from; i < to; i++) this.rawBuffer.push(arr[i]);
  }

  // -- Mel spectrogram -------------------------------------------------------

  async _streamMel(nSamples) {
    const contextLen = nSamples + MEL_CONTEXT;
    const start = Math.max(0, this.rawBuffer.length - contextLen);
    const slice = this.rawBuffer.slice(start);

    const float32 = new Float32Array(slice.length);
    for (let i = 0; i < slice.length; i++) float32[i] = slice[i];

    const tensor = new ort.Tensor('float32', float32, [1, float32.length]);
    const result = await this.melSession.run({ [this.melSession.inputNames[0]]: tensor });
    const out = result[this.melSession.outputNames[0]];

    const data = out.data;
    const numFrames = data.length / 32;

    for (let f = 0; f < numFrames; f++) {
      const frame = new Float32Array(32);
      for (let b = 0; b < 32; b++) {
        frame[b] = data[f * 32 + b] / 10 + 2;
      }
      this.melBuffer.push(frame);
    }

    if (this.melBuffer.length > MEL_MAX_LEN) {
      this.melBuffer = this.melBuffer.slice(-MEL_MAX_LEN);
    }
  }

  // -- Embedding -------------------------------------------------------------

  async _embedding(melWindow) {
    const flat = new Float32Array(MEL_WINDOW * 32);
    for (let i = 0; i < MEL_WINDOW; i++) flat.set(melWindow[i], i * 32);

    const tensor = new ort.Tensor('float32', flat, [1, MEL_WINDOW, 32, 1]);
    const result = await this.embSession.run({ [this.embSession.inputNames[0]]: tensor });
    const out = result[this.embSession.outputNames[0]];

    return new Float32Array(out.data);
  }

  // -- Classification --------------------------------------------------------

  async _classifyOnce(startNdx) {
    const end = startNdx + CLS_INPUT_FRAMES;
    const endActual = end === 0 ? this.embBuffer.length : this.embBuffer.length + end;
    const startActual = this.embBuffer.length + startNdx;
    if (startActual < 0 || endActual > this.embBuffer.length) return 0;

    const features = this.embBuffer.slice(startActual, endActual);
    if (features.length < CLS_INPUT_FRAMES) return 0;

    const flat = new Float32Array(CLS_INPUT_FRAMES * 96);
    for (let i = 0; i < CLS_INPUT_FRAMES; i++) flat.set(features[i], i * 96);

    const tensor = new ort.Tensor('float32', flat, [1, CLS_INPUT_FRAMES, 96]);
    const result = await this.clsSession.run({ [this.clsSession.inputNames[0]]: tensor });

    return result[this.clsSession.outputNames[0]].data[0];
  }

  async _classifyMulti(nChunks) {
    if (this.embBuffer.length < CLS_INPUT_FRAMES) return 0;
    if (this.frameCount < WARMUP_FRAMES) return 0;

    if (nChunks <= 1) {
      return this._classifyOnce(-CLS_INPUT_FRAMES);
    }

    let maxScore = 0;
    for (let i = nChunks - 1; i >= 0; i--) {
      const startNdx = -CLS_INPUT_FRAMES - i;
      const score = await this._classifyOnce(startNdx);
      if (score > maxScore) maxScore = score;
    }
    return maxScore;
  }
}

// ---------------------------------------------------------------------------
// Audio capture + inference loop
// ---------------------------------------------------------------------------

async function processLoop() {
  while (_processQueue.length > 0 && _active) {
    const chunk = _processQueue.shift();
    try {
      const score = await _engine.processAudio(chunk);
      if (score >= THRESHOLD) {
        const now = Date.now();
        if (now - _engine.lastDetection >= DEBOUNCE_MS) {
          _engine.lastDetection = now;
          _callback?.();
        }
      }
    } catch (err) {
      console.error('[Kiki WakeWord] Inference error:', err);
    }
  }
  _processing = false;
}

function enqueue(int16) {
  _processQueue.push(int16);
  if (!_processing) {
    _processing = true;
    processLoop();
  }
}

function downsample(buffer, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = buffer[Math.round(i * ratio)];
  }
  return result;
}

/**
 * Initialize wake word detection with local ONNX inference.
 * @param {Function} onDetected — called when the wake word fires
 */
export async function initWakeWord(onDetected) {
  await destroyWakeWord();

  _callback = onDetected;
  _processQueue = [];
  _processing = false;

  _engine = new WakeWordEngine();
  await _engine.init();

  try {
    _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw new Error('Microphone access denied — grant mic permission to the extension and reload');
  }

  _audioCtx = new AudioContext({ sampleRate: 16000 });

  if (_audioCtx.sampleRate !== 16000) {
    console.warn(
      `[Kiki WakeWord] Requested 16 kHz but got ${_audioCtx.sampleRate} Hz — resampling`,
    );
  }

  _sourceNode = _audioCtx.createMediaStreamSource(_stream);

  await _audioCtx.audioWorklet.addModule(
    chrome.runtime.getURL('offscreen/audio-processor.js')
  );
  _processorNode = new AudioWorkletNode(_audioCtx, 'audio-chunk-processor', {
    processorOptions: { bufferSize: BUFFER_SIZE },
  });

  _processorNode.port.onmessage = (event) => {
    if (!_active || !_engine) return;

    const float32 = event.data;

    let samples = float32;
    if (_audioCtx.sampleRate !== 16000) {
      samples = downsample(float32, _audioCtx.sampleRate, 16000);
    }

    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
    }

    enqueue(int16);
  };

  _sourceNode.connect(_processorNode);
  _processorNode.connect(_audioCtx.destination);

  _active = true;
}

export async function destroyWakeWord() {
  _active = false;
  _processQueue = [];
  _processing = false;

  if (_processorNode) {
    try { _processorNode.port.close(); } catch {}
    try { _processorNode.disconnect(); } catch {}
    _processorNode = null;
  }

  if (_sourceNode) {
    try { _sourceNode.disconnect(); } catch {}
    _sourceNode = null;
  }

  if (_audioCtx) {
    try { await _audioCtx.close(); } catch {}
    _audioCtx = null;
  }

  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }

  _engine = null;
  _callback = null;
}
