import speech from '@google-cloud/speech';
const client = new speech.SpeechClient();

/**
 * Transcribe a full audio buffer using Google Cloud Speech-to-Text.
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function googleChunk(bytes) {
  try {
    const [resp] = await client.recognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
      },
      audio: { content: Buffer.from(bytes).toString('base64') },
    });

    return resp.results
      ?.map(r => r.alternatives?.[0]?.transcript)
      .filter(Boolean)
      .join('\n') || '';
  } catch (err) {
    console.error("googleChunk error:", err);
    return '';
  }
}

/**
 * Creates a streaming Google Speech-to-Text session over WebSocket.
 * @param {WebSocket} ws
 */
export function googleStream(ws) {
  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
    },
    interimResults: true,
  };

  let recognizeStream = null;

  function safeEnd() {
    if (recognizeStream) {
      try {
        recognizeStream.end();
      } catch (err) {
        console.warn("Stream end error:", err.message);
      }
      recognizeStream = null;
    }
  }

  try {
    recognizeStream = client
      .streamingRecognize(request)
      .on('error', (e) => {
        console.error("Google Speech error:", e);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: String(e) }));
          ws.close(1011, "Google stream error");
        }
        safeEnd();
      })
      .on('data', (data) => {
        if (!data.results?.[0]) return;

        const result = data.results[0];
        const transcript = result.alternatives?.[0]?.transcript || '';

        if (transcript) {
          console.log("Transcript:", transcript);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: result.isFinal ? 'final' : 'interim',
              text: transcript,
            }));
          }
        }
      });
  } catch (err) {
    console.error("Failed to init Google stream:", err);
    if (ws.readyState === ws.OPEN) {
      ws.close(1011, "Google stream init error");
    }
    return;
  }

  ws.on('message', (msg) => {
    if (!recognizeStream) return;
    try {
      recognizeStream.write(Buffer.from(msg));
    } catch (err) {
      console.warn("Write after close ignored:", err.message);
    }
  });

  ws.on('close', () => {
    safeEnd();
  });
}
