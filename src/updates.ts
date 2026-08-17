import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; notes?: string }
  | { status: "downloading"; version: string; percent?: number }
  | { status: "ready"; version: string }
  | { status: "unavailable"; reason: string };

export interface UpdaterPort {
  check(): Promise<Update | null>;
  relaunch(): Promise<void>;
}

/**
 * Puerto real del actualizador. La verificación de firma ocurre en Rust con la
 * clave pública declarada en `tauri.conf.json`: un binario sin esa firma no se
 * instala aunque el manifiesto lo anuncie.
 */
export const tauriUpdater: UpdaterPort = {
  check: () => check(),
  relaunch: () => relaunch(),
};

/**
 * Busca una actualización sin interrumpir el trabajo. Fuera de Tauri —o sin red—
 * la app sigue siendo utilizable: la actualización es una comodidad, no un
 * requisito para abrir una carpeta local.
 */
export async function checkForUpdate(
  updater: UpdaterPort = tauriUpdater,
): Promise<{ state: UpdateState; update?: Update }> {
  try {
    const update = await updater.check();
    if (!update) return { state: { status: "current" } };
    return {
      state: {
        status: "available",
        version: update.version,
        ...(update.body ? { notes: update.body } : {}),
      },
      update,
    };
  } catch (error) {
    return { state: { status: "unavailable", reason: describe(error) } };
  }
}

/** Descarga e instala informando progreso; al terminar la app debe reiniciarse. */
export async function installUpdate(
  update: Update,
  onState: (state: UpdateState) => void,
  updater: UpdaterPort = tauriUpdater,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  onState({ status: "downloading", version: update.version });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onState({
          status: "downloading",
          version: update.version,
          ...(total > 0 ? { percent: Math.min(100, Math.round((downloaded / total) * 100)) } : {}),
        });
      }
      if (event.event === "Finished") onState({ status: "ready", version: update.version });
    });
    onState({ status: "ready", version: update.version });
    await updater.relaunch();
  } catch (error) {
    onState({ status: "unavailable", reason: describe(error) });
  }
}

function describe(error: unknown): string {
  const message = String(error);
  // Nunca se muestra una ruta del host ni un stack en la interfaz.
  if (/network|fetch|dns|timeout/i.test(message)) return "No pudimos consultar las actualizaciones.";
  if (/signature|pubkey/i.test(message)) return "La actualización no superó la verificación de firma.";
  return "Las actualizaciones no están disponibles en esta instalación.";
}
