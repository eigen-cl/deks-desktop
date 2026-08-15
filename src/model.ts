import type { DeksDocument } from "@deks-js/document";

export interface OpenProject {
  path: string;
  document: DeksDocument;
}

export interface ProjectChanged {
  path: string;
  revision: number;
  origin: "user" | "agent" | "external";
  changedSlideIds: string[];
  changedElementIds: string[];
}

export function createPresentation(name: string, id: string = crypto.randomUUID()): DeksDocument {
  return {
    id,
    name,
    revision: 0,
    canvasWidth: 1600,
    canvasHeight: 900,
    motionBeatMs: 600,
    palette: {
      primary: "#15171c",
      secondary: "#2d3748",
      accent: "#ff6b35",
      background: "#f7f1e8",
      text: "#15171c",
      subtext: "#596273",
    },
    history: { canUndo: false, canRedo: false },
    slides: [
      {
        id: `${id}:slide:${crypto.randomUUID()}`,
        name: "Inicio",
        isTemplate: false,
        background: { kind: "solid", color: "#f7f1e8" },
        inPreset: "fade",
        outPreset: "fade",
        inDurationMultiplier: 1,
        outDurationMultiplier: 1,
        elements: [],
      },
    ],
    transitions: [],
  };
}
