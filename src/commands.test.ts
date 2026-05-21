import { describe, expect, it } from "vitest";
import { type AppCommand, filterCommands, isCommandEnabled } from "./commands";

const noop = () => undefined;

const commands: AppCommand[] = [
  {
    id: "workspace.openFolder",
    title: "Open Workspace Folder",
    category: "Workspace",
    keywords: ["project", "directory"],
    run: noop,
  },
  {
    id: "file.save",
    title: "Save D2 Source",
    category: "File",
    shortcut: "Command/Ctrl + S",
    run: noop,
  },
  {
    id: "view.zoomIn",
    title: "Zoom In",
    category: "View",
    keywords: ["increase", "scale"],
    run: noop,
  },
];

describe("commands", () => {
  it("matches commands by title, keyword, shortcut, and id", () => {
    expect(filterCommands(commands, "workspace").map((command) => command.id)).toEqual([
      "workspace.openFolder",
    ]);
    expect(filterCommands(commands, "project").map((command) => command.id)).toEqual([
      "workspace.openFolder",
    ]);
    expect(filterCommands(commands, "ctrl s").map((command) => command.id)).toEqual([
      "file.save",
    ]);
    expect(filterCommands(commands, "view zoom").map((command) => command.id)).toEqual([
      "view.zoomIn",
    ]);
  });

  it("keeps declaration order for an empty query", () => {
    expect(filterCommands(commands, "").map((command) => command.id)).toEqual([
      "workspace.openFolder",
      "file.save",
      "view.zoomIn",
    ]);
  });

  it("treats commands as enabled unless explicitly disabled", () => {
    expect(isCommandEnabled(commands[0])).toBe(true);
    expect(isCommandEnabled({ ...commands[0], enabled: false })).toBe(false);
  });
});
