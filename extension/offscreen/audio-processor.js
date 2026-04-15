class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.bufferSize = options.processorOptions?.bufferSize || 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let offset = 0;
    while (offset < input.length) {
      const remaining = this.bufferSize - this.writeIndex;
      const toCopy = Math.min(remaining, input.length - offset);
      this.buffer.set(input.subarray(offset, offset + toCopy), this.writeIndex);
      this.writeIndex += toCopy;
      offset += toCopy;

      if (this.writeIndex >= this.bufferSize) {
        this.port.postMessage(this.buffer.slice());
        this.writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
