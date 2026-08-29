import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlideNarration } from "../src/editor/SlideNarration";
import { translator } from "../src/i18n";

const audio = vi.hoisted(() => ({
  begin: vi.fn(),
  cancel: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../src/editor/narration-audio", () => ({
  beginNarrationRecording: audio.begin,
}));

describe("autoría de narración por slide", () => {
  beforeEach(() => {
    audio.cancel.mockReset();
    audio.stop.mockReset();
    audio.begin.mockReset().mockResolvedValue({ cancel: audio.cancel, stop: audio.stop });
  });

  it("cancela y descarta la toma al cambiar de slide", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn(async () => true);
    const common = {
      t: translator("es"),
      narration: { script: "Guion listo", pauseBeforeMs: 0, pauseAfterMs: 0 },
      onSet: vi.fn(),
      onRecord,
      onClear: vi.fn(),
    };
    const view = render(<SlideNarration {...common} slideId="slide-one" />);

    await user.click(screen.getByRole("button", { name: "Grabar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Grabando");

    view.rerender(<SlideNarration {...common} slideId="slide-two" />);

    await waitFor(() => expect(audio.cancel).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Detener" })).not.toBeInTheDocument();
    expect(onRecord).not.toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });
});
