import type { AnnotationCommand, AnnotationRecord } from "./contracts";

export function invertAnnotationCommand(command: AnnotationCommand): AnnotationCommand {
  switch (command.type) {
    case "create":
      return { type: "delete", annotation: command.annotation };
    case "delete":
      return { type: "create", annotation: command.annotation };
    case "update":
      return { type: "update", before: command.after, after: command.before };
    case "batch":
      return {
        type: "batch",
        commands: command.commands.toReversed().map(invertAnnotationCommand),
      };
  }
}

export function applyAnnotationCommand(
  annotations: readonly AnnotationRecord[],
  command: AnnotationCommand,
): AnnotationRecord[] {
  switch (command.type) {
    case "create":
      return [...annotations, command.annotation];
    case "delete":
      return annotations.filter(({ id }) => id !== command.annotation.id);
    case "update":
      return annotations.map((annotation) =>
        annotation.id === command.before.id ? command.after : annotation,
      );
    case "batch":
      return command.commands.reduce<AnnotationRecord[]>(applyAnnotationCommand, [...annotations]);
  }
}
