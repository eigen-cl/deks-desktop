import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

export interface ModalProps {
  title: string;
  closeLabel: string;
  /** Ancho del diálogo. `wide` es para contenido con dos columnas. */
  size?: "regular" | "wide";
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
}

/**
 * Diálogo modal del host: atrapa el foco, cierra con Escape y lo devuelve a
 * quien lo abrió. Es propio y no de una librería porque es lo único que la app
 * necesita de un sistema de overlays, y traer uno entero costaría más que esto.
 */
export function Modal({ title, closeLabel, size = "regular", children, footer, onClose }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  // El cierre se lee desde un ref y el efecto no depende de él: si dependiera,
  // cada tecla escrita en un campo del diálogo volvería a montar la trampa de
  // foco y lo devolvería a quien lo abrió, perdiendo el resto de lo escrito.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusable = () => [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'button,input,select,textarea,[href],[tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ].filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);

    queueMicrotask(() => (focusable().find((node) => !node.classList.contains("modal__close")) ?? dialog.current)?.focus());

    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      opener?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialog}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal__head">
          <h2>{title}</h2>
          <IconButton className="modal__close" label={closeLabel} onClick={onClose}><X aria-hidden="true" /></IconButton>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}
