import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// La limpieza automática de Testing Library sólo se registra sola cuando Vitest
// expone sus globales. Aquí no lo hace, así que sin esto cada `render` deja su
// árbol en el documento y la consulta del test siguiente encuentra dos.
afterEach(cleanup);

// jsdom no implementa observadores de layout ni captura de puntero, y los
// controles de la app —desplegables, miniaturas perezosas— los usan de verdad.
// Sin estos dobles la prueba fallaría por el entorno y no por el componente.
class NoopObserver {
  observe(_target?: Element) {}
  unobserve(_target?: Element) {}
  disconnect() {}
  takeRecords() { return []; }
}

/**
 * Lo que se observa en jsdom nunca entra ni sale de la vista, así que un doble
 * inerte dejaría sin ejecutar todo lo que la app carga al aparecer —portadas y
 * miniaturas— y la prueba mediría una pantalla vacía. Este doble responde una
 * vez que sí es visible, que es el caso que interesa comprobar.
 */
class VisibleObserver extends NoopObserver {
  constructor(private readonly notify: IntersectionObserverCallback) { super(); }
  override observe(target: Element) {
    this.notify([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= VisibleObserver as unknown as typeof IntersectionObserver;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
