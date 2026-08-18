import { useCallback, useEffect, useState } from "react";

export interface EditorPreferences {
  animateSlideChange: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  snapToElements: boolean;
  gridStep: number;
}

export const DEFAULT_PREFERENCES: EditorPreferences = {
  animateSlideChange: true,
  showGrid: false,
  snapToGrid: false,
  snapToElements: true,
  gridStep: 16,
};

const KEY = "deks.desktop.editor.preferences.v1";

export function loadPreferences(): EditorPreferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!stored || typeof stored !== "object") return DEFAULT_PREFERENCES;
    const merged = { ...DEFAULT_PREFERENCES, ...(stored as Partial<EditorPreferences>) };
    // Un paso inválido guardado a mano dejaría el ajuste sin efecto y sin
    // explicación: se vuelve al valor por defecto en silencio.
    if (!Number.isFinite(merged.gridStep) || merged.gridStep < 1) merged.gridStep = DEFAULT_PREFERENCES.gridStep;
    return merged;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Preferencias del editor: son del host y no del documento, así que viven en el
 * almacenamiento local y nunca dentro de la carpeta de la presentación. Una
 * carpeta DEKS tiene que poder copiarse a otro equipo sin arrastrar ajustes.
 */
export function useEditorPreferences() {
  const [preferences, setPreferences] = useState<EditorPreferences>(loadPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(preferences));
    } catch {
      // Sin almacenamiento el editor sigue funcionando; sólo no recuerda.
    }
  }, [preferences]);

  const update = useCallback(
    (patch: Partial<EditorPreferences>) => setPreferences((current) => ({ ...current, ...patch })),
    [],
  );

  return [preferences, update] as const;
}
