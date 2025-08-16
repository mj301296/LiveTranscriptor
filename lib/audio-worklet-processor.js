class Downsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sampleRateIn = sampleRate;
    this.targetRate = 16000;
  }
  process(inputs) {
    const ch0 = inputs[0]?.[0];
    if (!ch0) return true;
    const ratio = this.sampleRateIn / this.targetRate;
    const out = new Int16Array(Math.floor(ch0.length / ratio));
    let o = 0; let i = 0;
    while (o < out.length) {
      out[o++] = Math.max(-1, Math.min(1, ch0[Math.floor(i)])) * 0x7fff;
      i += ratio;
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor('downsampler', Downsampler);
