import { useEffect } from "react";
import { isTextEditingTarget } from "./keyboard";

export interface SlideKeyboardNavigationOptions {
  slides: readonly { id: string }[];
  activeSlideId: string;
  enabled: boolean;
  onNavigate(slideId: string): void;
}

/**
 * Mantiene la navegación global fuera de la UI del rail y deja un solo dueño
 * del teclado: cuando Presenter está activo, el editor desmonta este listener.
 */
export function useSlideKeyboardNavigation({
  slides,
  activeSlideId,
  enabled,
  onNavigate,
}: SlideKeyboardNavigationOptions) {
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const current = slides.findIndex(({ id }) => id === activeSlideId);
      const next = current + (event.key === "ArrowRight" ? 1 : -1);
      if (current < 0 || next < 0 || next >= slides.length) return;

      event.preventDefault();
      onNavigate(slides[next]!.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [activeSlideId, enabled, onNavigate, slides]);
}
