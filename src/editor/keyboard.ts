/**
 * Los atajos globales nunca deben apropiarse de teclas que pertenecen a un
 * control de edición. `closest` también cubre nodos hijos dentro de un editor
 * contenteditable, no sólo el contenedor que declara el atributo.
 */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  const editable = target.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}
