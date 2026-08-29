import { describe, expect, it, vi } from "vitest";
import { inspectDeksAudio } from "@deks-js/document";
import { beginNarrationRecording, encodeNarrationWav } from "../src/editor/narration-audio";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("audio portable de narración", () => {
  it("mezcla canales, remuestrea a mono 24 kHz y escribe WAV PCM 16-bit", () => {
    const left = new Float32Array([1, 0.5, 0, -0.5, -1, 0, 0.5, 1]);
    const right = new Float32Array([-1, -0.5, 0, 0.5, 1, 0, -0.5, -1]);

    const wav = encodeNarrationWav([left, right], 48_000, 24_000);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    // Canales opuestos se cancelan: no se conserva estéreo accidentalmente.
    expect([...wav.slice(44)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("rechaza entradas vacías o frecuencias imposibles antes de reservar bytes", () => {
    expect(() => encodeNarrationWav([], 48_000)).toThrow(/audio_channels_invalid/);
    expect(() => encodeNarrationWav([new Float32Array()], 48_000)).toThrow(/audio_empty/);
    expect(() => encodeNarrationWav([new Float32Array([0])], 0)).toThrow(/audio_sample_rate_invalid/);
    expect(() => encodeNarrationWav([new Float32Array([0]), new Float32Array([0, 1])], 48_000))
      .toThrow(/audio_channels_mismatch/);
  });

  it("consulta el límite de Core antes de reservar un WAV demasiado largo", () => {
    const samples = new Float32Array(48_000);
    expect(() => encodeNarrationWav([samples], 48_000, 24_000, { maxBytes: 50_000_000, maxDurationMs: 500 }))
      .toThrow(/audio_too_large/);
  });

  it("pide el micrófono al comenzar, detiene el track y nunca persiste el contenedor temporal", async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    class FakeRecorder extends EventTarget {
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      constructor(_stream: MediaStream) { super(); }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        const chunk = new Event("dataavailable") as Event & { data: Blob };
        chunk.data = new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType });
        this.dispatchEvent(chunk);
        this.dispatchEvent(new Event("stop"));
      }
    }
    Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeRecorder });

    class FakeAudioContext {
      async decodeAudioData(_bytes: ArrayBuffer) {
        return {
          numberOfChannels: 1,
          sampleRate: 48_000,
          getChannelData: () => new Float32Array([0, 0.25, -0.25, 0]),
        } as unknown as AudioBuffer;
      }
      async close() {}
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    const recording = await beginNarrationRecording();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(stopTrack).not.toHaveBeenCalled();

    const wav = await recording.stop();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(inspectDeksAudio(wav, "audio/wav")).toMatchObject({
      mediaType: "audio/wav", sampleRate: 24_000, channels: 1, bitsPerSample: 16,
    });
    expect(ascii(wav, 0, 4)).toBe("RIFF");
  });
});
