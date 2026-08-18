import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  label: string;
  children: ReactNode;
}

/**
 * Botón de sólo ícono con nombre accesible y tooltip nativo. El nombre nunca
 * es opcional: un ícono sin etiqueta deja el control mudo para el teclado y
 * para quien lea la pantalla.
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, children, className = "", ...props },
  ref,
) {
  return (
    <button ref={ref} type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
});
