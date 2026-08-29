import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { DEKS_DOCUMENT_LIMITS, type DeksSlideNarration } from "@deks-js/document";
import type { Translate } from "../i18n";
import { NumberField, TextAreaField } from "../ui/fields";
import { beginNarrationRecording, type NarrationRecording } from "./narration-audio";

interface SlideNarrationProps {
  slideId: string;
  t: Translate;
  narration?: DeksSlideNarration;
  audioUrl?: string;
  disabled?: boolean;
  onSet(narration: DeksSlideNarration): void;
  onRecord(bytes: Uint8Array): Promise<boolean>;
  onClear(): void;
}

function draft(narration?: DeksSlideNarration): DeksSlideNarration {
  return narration ?? { script: "", pauseBeforeMs: 0, pauseAfterMs: 0 };
}

function recordingErrorKey(error: unknown): "narration.error.permission" | "narration.error.unsupported" | "narration.error.invalid" {
  const message = String(error);
  if (message.includes("NotAllowed") || message.includes("Permission")) return "narration.error.permission";
  if (message.includes("unavailable") || message.includes("NotSupported")) return "narration.error.unsupported";
  return "narration.error.invalid";
}

/** Slide-owned authoring UI. It never stores a device path or source codec. */
export function SlideNarration({ slideId, t, narration, audioUrl, disabled = false, onSet, onRecord, onClear }: SlideNarrationProps) {
  const recording = useRef<NarrationRecording>();
  const mounted = useRef(true);
  const generation = useRef(0);
  const [state, setState] = useState<"idle" | "starting" | "recording" | "processing">("idle");
  const [error, setError] = useState<ReturnType<typeof recordingErrorKey>>();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recording.current?.cancel();
    };
  }, []);

  useEffect(() => {
    generation.current += 1;
    recording.current?.cancel();
    recording.current = undefined;
    setState("idle");
    setError(undefined);
  }, [slideId]);

  const start = async () => {
    if (recording.current || disabled) return;
    const attempt = generation.current;
    setError(undefined);
    setState("starting");
    try {
      const next = await beginNarrationRecording();
      if (!mounted.current || attempt !== generation.current) {
        next.cancel();
        return;
      }
      recording.current = next;
      setState("recording");
    } catch (caught) {
      if (!mounted.current || attempt !== generation.current) return;
      setError(recordingErrorKey(caught));
      setState("idle");
    }
  };

  const stop = async () => {
    const active = recording.current;
    if (!active) return;
    const attempt = generation.current;
    setState("processing");
    setError(undefined);
    try {
      const bytes = await active.stop();
      if (!mounted.current || attempt !== generation.current) return;
      if (!await onRecord(bytes)) setError("narration.error.invalid");
    } catch (caught) {
      if (mounted.current && attempt === generation.current) setError(recordingErrorKey(caught));
    } finally {
      if (recording.current === active) recording.current = undefined;
      if (mounted.current && attempt === generation.current) setState("idle");
    }
  };

  const value = draft(narration);
  const busy = state !== "idle";
  const hasAudio = Boolean(narration?.audio);
  const scriptMissing = value.script.trim() === "";

  return (
    <section className="panel narration-panel" aria-labelledby="slide-narration-title">
      <h3 id="slide-narration-title">{t("narration.title")}</h3>
      <p className="panel__hint">{t("narration.hint")}</p>
      <TextAreaField
        label={t("narration.script")}
        value={value.script}
        disabled={disabled || busy}
        onChange={(script) => onSet({ ...value, script })}
      />
      <div className="panel__grid">
        <NumberField
          label={t("narration.pauseBefore")}
          value={value.pauseBeforeMs}
          min={0}
          max={DEKS_DOCUMENT_LIMITS.maxNarrationPauseMs}
          step={100}
          disabled={disabled || busy}
          onCommit={(pauseBeforeMs) => onSet({
            ...value,
            pauseBeforeMs: Math.max(0, Math.min(DEKS_DOCUMENT_LIMITS.maxNarrationPauseMs, Math.round(pauseBeforeMs))),
          })}
        />
        <NumberField
          label={t("narration.pauseAfter")}
          value={value.pauseAfterMs}
          min={0}
          max={DEKS_DOCUMENT_LIMITS.maxNarrationPauseMs}
          step={100}
          disabled={disabled || busy}
          onCommit={(pauseAfterMs) => onSet({
            ...value,
            pauseAfterMs: Math.max(0, Math.min(DEKS_DOCUMENT_LIMITS.maxNarrationPauseMs, Math.round(pauseAfterMs))),
          })}
        />
      </div>

      {audioUrl && (
        <audio className="narration-panel__audio" controls preload="metadata" src={audioUrl} aria-label={t("narration.audioPlayer")}>
          {t("narration.audioUnsupported")}
        </audio>
      )}

      <div className="narration-panel__actions">
        {state === "recording" ? (
          <button type="button" className="button button--primary" onClick={() => void stop()}>
            <Square aria-hidden="true" /> {t("narration.stop")}
          </button>
        ) : (
          <button type="button" className="button" disabled={disabled || busy || scriptMissing} onClick={() => void start()}>
            <Mic aria-hidden="true" /> {t(hasAudio ? "narration.replace" : "narration.record")}
          </button>
        )}
        {narration && (
          <button type="button" className="button button--danger" disabled={disabled || busy} onClick={onClear}>
            <Trash2 aria-hidden="true" /> {t("narration.delete")}
          </button>
        )}
      </div>

      {scriptMissing && <p className="narration-panel__status">{t("narration.scriptRequired")}</p>}

      {state === "starting" && <p className="narration-panel__status" role="status">{t("narration.requesting")}</p>}
      {state === "recording" && <p className="narration-panel__status is-recording" role="status">{t("narration.recording")}</p>}
      {state === "processing" && <p className="narration-panel__status" role="status">{t("narration.processing")}</p>}
      {error && <p className="narration-panel__error" role="alert">{t(error)}</p>}
    </section>
  );
}
