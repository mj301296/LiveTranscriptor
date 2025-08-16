export class RingBuffer {
  constructor(maxBytes = 60 * 1024 * 1024) {
    this.max = maxBytes;
    this.buf = new Uint8Array(this.max);
    this.start = 0;
    this.end = 0;
    this.size = 0;
  }

  push(chunk) {
    if (!(chunk instanceof Uint8Array)) chunk = new Uint8Array(chunk);
    for (let i = 0; i < chunk.length; i++) {
      if (this.size === this.max) {
        // Overwrite oldest byte
        this.start = (this.start + 1) % this.max;
        this.size--;
      }
      this.buf[this.end] = chunk[i];
      this.end = (this.end + 1) % this.max;
      this.size++;
    }
  }

  drain(n) {
    const len = Math.min(n, this.size);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = this.buf[(this.start + i) % this.max];
    }
    this.start = (this.start + len) % this.max;
    this.size -= len;
    return out;
  }

  toArray() {
    return this.drain(this.size);
  }

  get length() {
    return this.size;
  }
}
