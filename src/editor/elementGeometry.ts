import type { Anchor } from "@deks-js/document";
import type { EditorElement } from "./elements";

export type ResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";

export const anchorOf = (element: Pick<EditorElement, "anchor">): Anchor =>
  element.anchor ?? { x: 0, y: 0 };

export function rotateVector(x: number, y: number, rotationDeg: number) {
  const radians = rotationDeg * Math.PI / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

/** CSS border box before rotation; the authored x/y remain the pivot. */
export function positionedBox(element: Pick<EditorElement, "x" | "y" | "width" | "height" | "anchor">) {
  const anchor = anchorOf(element as Pick<EditorElement, "anchor">);
  return {
    left: element.x - anchor.x * element.width,
    top: element.y - anchor.y * element.height,
    width: element.width,
    height: element.height,
  };
}

/** Canvas-axis bounds used by snapping, including anchor and rotation. */
export function elementAabb(element: Pick<EditorElement, "x" | "y" | "width" | "height" | "anchor" | "rotationDeg">) {
  const anchor = anchorOf(element as Pick<EditorElement, "anchor">);
  const corners = [
    [-anchor.x * element.width, -anchor.y * element.height],
    [(1 - anchor.x) * element.width, -anchor.y * element.height],
    [(1 - anchor.x) * element.width, (1 - anchor.y) * element.height],
    [-anchor.x * element.width, (1 - anchor.y) * element.height],
  ].map(([x, y]) => {
    const offset = rotateVector(x!, y!, element.rotationDeg);
    return { x: element.x + offset.x, y: element.y + offset.y };
  });
  return {
    left: Math.min(...corners.map(({ x }) => x)),
    top: Math.min(...corners.map(({ y }) => y)),
    right: Math.max(...corners.map(({ x }) => x)),
    bottom: Math.max(...corners.map(({ y }) => y)),
  };
}

/**
 * Resizes in the element's rotated local axes. The opposite local edges stay
 * fixed in canvas space and x/y continue to identify the authored pivot.
 */
export function resizeFromHandle(
  element: EditorElement,
  handle: ResizeHandle,
  canvasDeltaX: number,
  canvasDeltaY: number,
): EditorElement {
  const delta = rotateVector(canvasDeltaX, canvasDeltaY, -element.rotationDeg);
  let width = element.width;
  let height = element.height;
  let offsetX = 0;
  let offsetY = 0;
  if (handle.includes("e")) width = Math.max(1, element.width + delta.x);
  if (handle.includes("s")) height = Math.max(1, element.height + delta.y);
  if (handle.includes("w")) {
    width = Math.max(1, element.width - delta.x);
    offsetX = element.width - width;
  }
  if (handle.includes("n")) {
    height = Math.max(1, element.height - delta.y);
    offsetY = element.height - height;
  }

  const anchor = anchorOf(element);
  const oldTopLeft = rotateVector(-anchor.x * element.width, -anchor.y * element.height, element.rotationDeg);
  const movedTopLeft = rotateVector(offsetX, offsetY, element.rotationDeg);
  const nextAnchor = rotateVector(anchor.x * width, anchor.y * height, element.rotationDeg);
  return {
    ...element,
    x: element.x + oldTopLeft.x + movedTopLeft.x + nextAnchor.x,
    y: element.y + oldTopLeft.y + movedTopLeft.y + nextAnchor.y,
    width,
    height,
  };
}
