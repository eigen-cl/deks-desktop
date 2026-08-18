import { useEffect, useRef, type ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  run(): void;
}

export interface MenuProps {
  label: string;
  /** Punto en coordenadas de ventana donde nació el gesto. */
  point: { x: number; y: number };
  items: MenuItem[];
  onClose(): void;
}

const WIDTH = 236;
const ITEM = 32;

/**
 * Menú contextual. Se abre donde se hizo el gesto —clic derecho, Shift+F10 o
 * la tecla de menú— y se mantiene dentro de la ventana. Las flechas recorren
 * las opciones y Escape cierra devolviendo el foco a quien lo abrió, porque un
 * menú que se abandona con el puntero deja el teclado sin salida.
 */
export function Menu({ label, point, items, onClose }: MenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  // Igual que en el diálogo: el efecto se monta una vez y lee el cierre desde
  // un ref, para que un padre que se vuelve a renderizar no lo reinstale.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const options = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])];
    queueMicrotask(() => options()[0]?.focus());

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        close.current();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nodes = options();
      if (nodes.length === 0) return;
      const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? nodes.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % nodes.length
            : (current - 1 + nodes.length) % nodes.length;
      nodes[next]?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) close.current();
    };
    const dismiss = () => close.current();
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", dismiss);
      // El foco vuelve a quien abrió el menú sólo si el menú todavía lo tenía.
      // Una opción que abre un diálogo se lo entrega a ese diálogo, y
      // devolverlo aquí se lo robaría al campo recién enfocado.
      const active = document.activeElement;
      if (!menu.current?.contains(active) && active !== document.body) return;
      opener?.focus();
    };
  }, []);

  const height = items.length * ITEM + 12;
  return (
    <div
      ref={menu}
      className="menu"
      role="menu"
      aria-label={label}
      style={{
        left: Math.max(8, Math.min(point.x, window.innerWidth - WIDTH - 8)),
        top: Math.max(8, Math.min(point.y, window.innerHeight - height - 8)),
        width: WIDTH,
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={item.danger ? "is-danger" : undefined}
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          {/* La columna del ícono existe siempre: sin ella, las opciones que no
              lo tienen empiezan en otra sangría y la lista deja de leerse. */}
          <span className="menu__icon" aria-hidden="true">{item.icon}</span>
          <span className="menu__label">{item.label}</span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
