import {
  applyDeksCommands,
  type DeksCommand,
  type DeksCommandResult,
  type DeksDocument,
} from "@deks-js/document";

export function applyEditorCommands(
  source: DeksDocument,
  commands: readonly DeksCommand[],
): DeksCommandResult {
  return applyDeksCommands(source, commands);
}
