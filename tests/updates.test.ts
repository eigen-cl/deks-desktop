import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, installUpdate, type UpdaterPort } from "../src/updates";

type FakeUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: ReturnType<typeof vi.fn>;
};

const update = (overrides: Partial<FakeUpdate> = {}): FakeUpdate => ({
  version: "0.3.0",
  body: "Notas",
  downloadAndInstall: vi.fn(async () => undefined),
  ...overrides,
});

describe("actualización de DEKS Desktop", () => {
  it("informa cuando la instalación ya está al día", async () => {
    const port: UpdaterPort = { check: async () => null, relaunch: async () => undefined };

    expect((await checkForUpdate(port)).state).toEqual({ status: "current" });
  });

  it("expone la versión disponible sin instalarla sola", async () => {
    const available = update();
    const port: UpdaterPort = { check: async () => available as never, relaunch: async () => undefined };

    const result = await checkForUpdate(port);

    expect(result.state).toEqual({ status: "available", version: "0.3.0", notes: "Notas" });
    // Descargar es una decisión de la persona, no un efecto de comprobar.
    expect(available.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("mantiene la app usable cuando no hay red y nunca filtra el error crudo", async () => {
    const port: UpdaterPort = {
      check: async () => { throw new Error("error sending request for url (https://github.com/...)"); },
      relaunch: async () => undefined,
    };

    const result = await checkForUpdate(port);

    expect(result.state.status).toBe("unavailable");
    expect(JSON.stringify(result.state)).not.toMatch(/https?:/);
  });

  it("reporta progreso y reinicia sólo después de instalar", async () => {
    const states: string[] = [];
    const relaunch = vi.fn(async () => undefined);
    const available = update({
      downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 200 } });
        onEvent({ event: "Progress", data: { chunkLength: 100 } });
        onEvent({ event: "Finished", data: {} });
      }),
    });

    await installUpdate(available as never, (state) => states.push(state.status), { check: async () => null, relaunch });

    expect(states).toContain("downloading");
    expect(states.at(-1)).toBe("ready");
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("no reinicia si la instalación falla", async () => {
    const relaunch = vi.fn(async () => undefined);
    const states: string[] = [];
    const available = update({ downloadAndInstall: vi.fn(async () => { throw new Error("signature mismatch"); }) });

    await installUpdate(available as never, (state) => states.push(state.status), { check: async () => null, relaunch });

    expect(states.at(-1)).toBe("unavailable");
    expect(relaunch).not.toHaveBeenCalled();
  });
});
