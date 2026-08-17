import { useCallback, useEffect, useRef, useState } from "react";
import { applyDeksCommands, type DeksCommand, type DeksDocument } from "@deks-js/document";

export interface EditorPersistence {
  save(
    previousRevision: number,
    document: DeksDocument,
    changedSlideIds: string[],
    changedElementIds: string[],
  ): Promise<DeksDocument>;
}

/**
 * Todo cambio del editor pasa por los comandos canónicos de Core. No es una
 * formalidad: es lo que mantiene el documento en el mismo lenguaje que lee la
 * web, así que una presentación editada aquí se abre allá sin traducción. Un
 * atajo que mutara el documento a mano rompería esa promesa en silencio.
 *
 * El documento visible se actualiza de inmediato y se revierte entero si el
 * disco rechaza el cambio: media escritura aplicada sería peor que ninguna.
 */
export function useEditorDocument(source: DeksDocument, persistence: EditorPersistence) {
  const [document, setDocument] = useState(source);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [history, setHistory] = useState<{ past: DeksDocument[]; future: DeksDocument[] }>({ past: [], future: [] });
  const inFlight = useRef(false);
  const known = useRef(source);

  // Una revisión más nueva desde fuera —un agente, el MCP— reemplaza la copia
  // visible. Sólo cuando la fuente cambia de identidad, no en cada render.
  useEffect(() => {
    if (known.current === source) return;
    known.current = source;
    setDocument(source);
    setConflict(false);
    // Deshacer sobre una edición ajena reescribiría trabajo que no es de quien
    // pulsa: el historial local deja de aplicar y se descarta.
    setHistory({ past: [], future: [] });
  }, [source]);

  const dispatch = useCallback(async (
    operation: DeksCommand | readonly DeksCommand[],
  ): Promise<boolean> => {
    if (inFlight.current) return false;
    const commands = Array.isArray(operation) ? operation : [operation as DeksCommand];
    if (commands.length === 0) return true;

    const previous = document;
    let next;
    try {
      next = applyDeksCommands(previous, commands);
    } catch {
      // Un comando inválido no llega al disco ni ensucia la copia visible.
      return false;
    }

    inFlight.current = true;
    setPending(true);
    setDocument(next.document);
    try {
      const committed = await persistence.save(
        previous.revision,
        next.document,
        next.changeSet.changedSlideIds,
        next.changeSet.changedElementIds,
      );
      setDocument(committed);
      known.current = committed;
      setConflict(false);
      // Un comando, un paso: el historial guarda el documento anterior sólo
      // cuando el disco ya confirmó el nuevo. Rehacer muere al editar, porque
      // la rama que prometía dejó de existir.
      setHistory(({ past }) => ({ past: [...past, previous], future: [] }));
      return true;
    } catch (caught) {
      setDocument(previous);
      setConflict(String(caught).includes("revision_conflict"));
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [document, persistence]);

  /**
   * Deshacer y rehacer escriben el documento de destino como una revisión
   * nueva; nunca retroceden el contador. La revisión es el reloj compartido con
   * el watcher, el lock y los agentes: hacerla retroceder haría que una
   * escritura ajena pareciera vieja y se perdiera.
   */
  const travel = useCallback(async (direction: "undo" | "redo"): Promise<boolean> => {
    if (inFlight.current) return false;
    const stack = direction === "undo" ? history.past : history.future;
    const target = stack.at(-1);
    if (!target) return false;

    const current = document;
    const next = { ...target, revision: current.revision + 1 };
    inFlight.current = true;
    setPending(true);
    setDocument(next);
    try {
      const committed = await persistence.save(current.revision, next, [], []);
      setDocument(committed);
      known.current = committed;
      setConflict(false);
      setHistory(({ past, future }) => direction === "undo"
        ? { past: past.slice(0, -1), future: [...future, current] }
        : { past: [...past, current], future: future.slice(0, -1) });
      return true;
    } catch (caught) {
      setDocument(current);
      setConflict(String(caught).includes("revision_conflict"));
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [document, history, persistence]);

  return {
    document,
    dispatch,
    pending,
    conflict,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
