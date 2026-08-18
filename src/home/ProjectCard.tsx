import { useEffect, useRef, useState } from "react";
import type { DeksDocument } from "@deks-js/document";
import { SlideThumbnail } from "../editor/SlideThumbnail";
import { backgroundCss, type ProjectSummary } from "../model";
import type { Translate } from "../i18n";

export interface ProjectCardProps {
  t: Translate;
  locale: string;
  project: ProjectSummary;
  /** Lector de portada; inyectable para poder probar la tarjeta sin el host. */
  loadCover(path: string): Promise<DeksDocument>;
  onOpen(path: string): void;
  onOpenMenu(project: ProjectSummary, point: { x: number; y: number }): void;
}

/**
 * Tarjeta del inicio. La portada se dibuja con el mismo renderer que el editor
 * —una presentación se reconoce por su primera slide, no por su color de
 * fondo— pero sólo cuando la tarjeta llega a verse: listar veinte carpetas no
 * puede cargar veinte documentos completos antes del primer render.
 */
export function ProjectCard({ t, locale, project, loadCover, onOpen, onOpenMenu }: ProjectCardProps) {
  const root = useRef<HTMLButtonElement>(null);
  const [cover, setCover] = useState<DeksDocument>();

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let cancelled = false;
    const load = () => {
      void loadCover(project.path)
        .then((document) => { if (!cancelled) setCover(document); })
        .catch(() => {
          // Una portada ilegible no rompe el inicio: la tarjeta se queda con el
          // fondo real de la primera slide, que ya vino en el resumen.
        });
    };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [loadCover, project.path]);

  const ratio = project.canvas ? `${project.canvas.width} / ${project.canvas.height}` : "16 / 9";
  const updated = new Date(project.updatedAtMs);

  return (
    <button
      ref={root}
      type="button"
      className="card"
      onClick={() => onOpen(project.path)}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(project, { x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (!(event.shiftKey && event.key === "F10") && event.key !== "ContextMenu") return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu(project, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
    >
      <span className="card__frame" aria-hidden="true">
        {cover && cover.slides[0]
          ? <SlideThumbnail document={cover} slideId={cover.slides[0].id} className="card__cover" />
          : <span className="card__cover" style={{ background: backgroundCss(project.background), aspectRatio: ratio }} />}
      </span>
      <span className="card__name">{project.name}</span>
      <span className="card__meta">
        {project.slideCount === 1 ? t("home.slideCountOne") : t("home.slideCount", { count: project.slideCount })}
        {" · "}
        {Number.isFinite(project.updatedAtMs) && project.updatedAtMs > 0
          ? t("home.updatedAt", { date: updated.toLocaleDateString(locale, { day: "numeric", month: "short" }) })
          : t("home.revision", { revision: project.revision })}
      </span>
    </button>
  );
}
