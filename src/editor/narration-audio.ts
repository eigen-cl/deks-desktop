import { DEKS_AUDIO_LIMITS, inspectAndNormalizeDeksAsset } from "@deks-js/document";

export const NARRATION_SAMPLE_RATE = 24_000;

export interface NarrationRecording {
  stop(): Promise<Uint8Array>;
  cancel(): void;
}

/**
 * Convierte PCM flotante del Web Audio API al perfil portable que Core admite.
 * La mezcla y el remuestreo ocurren en memoria: el contenedor que haya emitido
 * WKWebView/Chromium nunca entra al `.deks`.
 */
export function encodeNarrationWav(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  targetSampleRate = NARRATION_SAMPLE_RATE,
  limits: Pick<typeof DEKS_AUDIO_LIMITS, "maxBytes" | "maxDurationMs"> = DEKS_AUDIO_LIMITS,
): Uint8Array {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0
    || !Number.isFinite(targetSampleRate)
    || targetSampleRate < DEKS_AUDIO_LIMITS.minSampleRate
    || targetSampleRate > DEKS_AUDIO_LIMITS.maxSampleRate) {
    throw new Error("audio_sample_rate_invalid");
  }
  if (channels.length === 0) throw new Error("audio_channels_invalid");
  const sourceLength = channels[0]!.length;
  if (sourceLength === 0) throw new Error("audio_empty");
  if (channels.some((channel) => channel.length !== sourceLength)) throw new Error("audio_channels_mismatch");

  const outputLength = Math.max(1, Math.round(sourceLength * targetSampleRate / sourceSampleRate));
  const byteLength = 44 + outputLength * 2;
  const durationMs = outputLength / targetSampleRate * 1_000;
  if (!Number.isSafeInteger(byteLength)
    || byteLength > limits.maxBytes
    || durationMs > limits.maxDurationMs) {
    throw new Error("audio_too_large");
  }
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, byteLength - 8, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, outputLength * 2, true);

  const ratio = sourceSampleRate / targetSampleRate;
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = outputIndex * ratio;
    const left = Math.min(sourceLength - 1, Math.floor(sourcePosition));
    const right = Math.min(sourceLength - 1, left + 1);
    const fraction = sourcePosition - left;
    let sample = 0;
    for (const channel of channels) sample += channel[left]! + (channel[right]! - channel[left]!) * fraction;
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(44 + outputIndex * 2, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
  }
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

async function decodedPortableWav(blob: Blob): Promise<Uint8Array> {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("audio_decode_unavailable");
  const context = new AudioContextConstructor();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
    const wav = encodeNarrationWav(channels, audio.sampleRate);
    return inspectAndNormalizeDeksAsset(wav, "audio/wav").bytes;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * `getUserMedia` y `MediaRecorder.start` se ejecutan dentro de esta llamada;
 * la UI debe invocarla directamente desde el botón Grabar para conservar el
 * gesto de permiso del WebView.
 */
export async function beginNarrationRecording(): Promise<NarrationRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("audio_recording_unavailable");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  const chunks: Blob[] = [];
  let capturedBytes = 0;
  let cancelled = false;
  let tooLarge = false;
  let durationTimer = 0;
  let resolveCompletion!: (bytes: Uint8Array) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<Uint8Array>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // `cancel` puede ocurrir sin que la UI haya pedido `stop`; la promesa sigue
  // siendo reutilizable, pero su rechazo no queda flotando en el WebView.
  void completion.catch(() => undefined);
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size === 0 || tooLarge || cancelled) return;
    capturedBytes += event.data.size;
    if (capturedBytes > DEKS_AUDIO_LIMITS.maxBytes) {
      tooLarge = true;
      if (recorder.state !== "inactive") recorder.stop();
      return;
    }
    chunks.push(event.data);
  });

  let settled = false;
  const release = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(durationTimer);
    for (const track of stream.getTracks()) track.stop();
  };
  recorder.addEventListener("error", () => {
    release();
    rejectCompletion(new Error("audio_recording_failed"));
  }, { once: true });
  recorder.addEventListener("stop", () => {
    release();
    if (cancelled) {
      rejectCompletion(new Error("audio_recording_cancelled"));
      return;
    }
    if (tooLarge) {
      rejectCompletion(new Error("audio_too_large"));
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "application/octet-stream" });
    void decodedPortableWav(blob).then(resolveCompletion, rejectCompletion);
  }, { once: true });
  // Un timeslice acotado permite aplicar el límite de bytes mientras se
  // captura, antes de decodificar o reservar el WAV definitivo.
  recorder.start(1_000);
  durationTimer = window.setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, DEKS_AUDIO_LIMITS.maxDurationMs);

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
      return completion;
    },
    cancel: () => {
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      else {
        release();
        rejectCompletion(new Error("audio_recording_cancelled"));
      }
    },
  };
}
