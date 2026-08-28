import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { LucideIconPicker } from "../src/editor/LucideIconPicker";
import { translator } from "../src/i18n";

it("busca el catálogo Lucide offline y elige por teclado sin renderizarlo completo", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  render(<LucideIconPicker t={translator("es")} value="shield-check" onValueChange={onValueChange} />);

  const search = screen.getByRole("combobox", { name: "Buscar ícono Lucide" });
  await user.type(search, "airplay");
  expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(60);
  await user.keyboard("{ArrowDown}{Enter}");

  expect(onValueChange).toHaveBeenCalledWith("airplay");
});

it("anuncia una búsqueda sin resultados", async () => {
  const user = userEvent.setup();
  render(<LucideIconPicker t={translator("es")} value="shield-check" onValueChange={() => undefined} />);

  await user.type(screen.getByRole("combobox", { name: "Buscar ícono Lucide" }), "no-existe-xyz");
  expect(screen.getByRole("status")).toHaveTextContent("No encontramos íconos");
});

it("permite recorrer todo el catálogo por páginas sin montar más de sesenta opciones", async () => {
  const user = userEvent.setup();
  render(<LucideIconPicker t={translator("es")} value="shield-check" onValueChange={() => undefined} />);

  await user.click(screen.getByRole("combobox", { name: "Buscar ícono Lucide" }));
  const firstPageName = screen.getAllByRole("option")[0]!.textContent;
  expect(screen.getAllByRole("option")).toHaveLength(60);

  await user.click(screen.getByRole("button", { name: "Página siguiente" }));
  expect(screen.getAllByRole("option")).toHaveLength(60);
  expect(screen.getAllByRole("option")[0]).not.toHaveTextContent(firstPageName!);

  await user.click(screen.getByRole("button", { name: "Página anterior" }));
  expect(screen.getAllByRole("option")[0]).toHaveTextContent(firstPageName!);
});
