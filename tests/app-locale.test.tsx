import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const host = vi.hoisted(() => ({
  persistLocale: vi.fn(),
  readWorkspace: vi.fn(),
}));

vi.mock("../src/desktop-api", () => ({
  addSourceFolder: vi.fn(),
  chooseDeksFile: vi.fn(),
  chooseDirectory: vi.fn(),
  chooseImage: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  detectAgents: vi.fn(async () => []),
  forgetManagedInstall: vi.fn(),
  importAsset: vi.fn(),
  installAgent: vi.fn(),
  listProjects: vi.fn(async () => []),
  migrateLegacyProject: vi.fn(),
  onProjectChanged: vi.fn(async () => () => undefined),
  openProject: vi.fn(),
  readProjectCover: vi.fn(),
  readWorkspace: host.readWorkspace,
  removeSourceFolder: vi.fn(),
  saveProject: vi.fn(),
  setLocale: host.persistLocale,
  syncManagedInstalls: vi.fn(async () => []),
  watchProject: vi.fn(),
}));

vi.mock("../src/updates", () => ({
  checkForUpdate: vi.fn(async () => ({ state: { status: "current" } })),
  installUpdate: vi.fn(),
}));

type Deferred = {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("preferencia global de idioma", () => {
  beforeEach(() => {
    host.persistLocale.mockReset();
    host.readWorkspace.mockResolvedValue({
      defaultRoot: "/tmp/DEKS",
      locale: "en",
      sourceFolders: [],
      managedInstalls: [],
    });
  });

  it("serializa cambios rápidos y un fallo tardío no revierte la selección vigente", async () => {
    const user = userEvent.setup();
    const spanish = deferred();
    const system = deferred();
    host.persistLocale
      .mockImplementationOnce(() => spanish.promise)
      .mockImplementationOnce(() => system.promise);

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));

    await choose(user, "Language", "Español");
    await choose(user, "Idioma", "System");

    expect(host.persistLocale).toHaveBeenCalledTimes(1);
    expect(host.persistLocale).toHaveBeenNthCalledWith(1, "es");

    await act(async () => spanish.reject(new Error("disk unavailable")));
    await waitFor(() => expect(host.persistLocale).toHaveBeenNthCalledWith(2, "system"));
    await act(async () => system.resolve());

    expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("System");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("revierte un fallo vigente a la última preferencia confirmada", async () => {
    const user = userEvent.setup();
    const spanish = deferred();
    host.persistLocale.mockImplementationOnce(() => spanish.promise);

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await choose(user, "Language", "Español");

    await act(async () => spanish.reject(new Error("disk unavailable")));

    expect(await screen.findByRole("combobox", { name: "Language" })).toHaveTextContent("English");
    expect(screen.getByRole("alert")).toHaveTextContent("We could not save the language");
  });
});
