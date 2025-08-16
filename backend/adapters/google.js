import speech from '@google-cloud/speech';
const client = new speech.SpeechClient();


export async function googleChunk(bytes){
  const [resp] = await client.recognize({
    config: { encoding:'LINEAR16', sampleRateHertz:16000, languageCode:'en-US', enableAutomaticPunctuation:true },
    audio: { content: Buffer.from(bytes).toString('base64') }
  });
  return resp.results?.map(r=>r.alternatives?.[0]?.transcript).join('\n') || '';
}

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

  let recognizeStream;

  try {
    recognizeStream = client.streamingRecognize(request)
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
        const transcript = result.alternatives[0]?.transcript || '';
        console.log(transcript);

        ws.send(JSON.stringify({
          type: result.isFinal ? 'final' : 'interim',
          text: transcript,
        }));
      });
  } catch (err) {
    console.error("Failed to init stream:", err);
    ws.close(1011, "Google stream init error");
    return;
  }

  // Safely end/cleanup
  function safeEnd() {
    if (recognizeStream) {
      try { recognizeStream.end(); } catch {}
      recognizeStream = null;
    }
  }

  ws.on('message', (msg) => {
    if (!recognizeStream) return; // don't write if closed
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
