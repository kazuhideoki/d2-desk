import { describe, expect, it } from "vitest";
import { type AppCommand, isCommandEnabled } from "../../shared/commands";
import type { Workspace } from "../../types";
import {
  createEditorAutoWidthCommand,
  createOpenCurrentWorkspaceCommands,
  createPreviewAutoZoomCommand,
  createRemoveCurrentWorkspaceCommand,
  createWorkspaceSelectionCommands,
  filterCommands,
} from "./commands";

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

  it("matches command title words when the query omits spaces", () => {
    const openCommands: AppCommand[] = [
      {
        id: "workspace.openFolder",
        title: "Open Workspace Folder",
        category: "Workspace",
        keywords: ["add", "register", "switch", "folder", "directory", "project"],
        run: noop,
      },
      {
        id: "workspace.select",
        title: "Select Workspace",
        category: "Workspace",
        keywords: ["switch", "change", "project", "folder"],
        run: noop,
      },
      {
        id: "file.openWorkspaceFile",
        title: "Open Workspace File",
        category: "File",
        keywords: ["workspace", "project", "quick open", "finder"],
        shortcut: "Command + P",
        run: noop,
      },
      {
        id: "workspace.openActiveInFinder",
        title: "Open Current Workspace in Finder",
        category: "Workspace",
        run: noop,
      },
    ];

    expect(filterCommands(openCommands, "opewor").map((command) => command.id)).toEqual([
      "file.openWorkspaceFile",
      "workspace.openFolder",
      "workspace.openActiveInFinder",
    ]);
    expect(filterCommands(openCommands, "zzzz")).toEqual([]);
    expect(filterCommands(openCommands, "未知")).toEqual([]);
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

  it("builds workspace selection commands for registered workspaces", () => {
    const selectedWorkspaceIds: Array<string | null> = [];
    const workspaceCommands = createWorkspaceSelectionCommands(
      [
        workspace({ id: "one", name: "Diagrams", rootPath: "/tmp/diagrams" }),
        workspace({ id: "two", name: "Architecture", rootPath: "/tmp/architecture" }),
      ],
      "one",
      (workspaceId) => {
        selectedWorkspaceIds.push(workspaceId);
      },
    );

    expect(workspaceCommands.map((command) => command.title)).toEqual([
      "No Workspace",
      "Diagrams",
      "Architecture",
    ]);
    expect(workspaceCommands.map((command) => command.enabled)).toEqual([true, false, true]);
    expect(filterCommands(workspaceCommands, "architecture").map((command) => command.id)).toEqual([
      "workspace.select.two",
    ]);

    workspaceCommands[2].run();
    expect(selectedWorkspaceIds).toEqual(["two"]);
  });

  it("builds current workspace open commands for Finder and $EDITOR", () => {
    const opened: string[] = [];
    const workspaceCommands = createOpenCurrentWorkspaceCommands(
      true,
      () => {
        opened.push("finder");
      },
      () => {
        opened.push("editor");
      },
    );

    expect(workspaceCommands.map((command) => command.id)).toEqual([
      "workspace.openActiveInFinder",
      "workspace.openActiveWithEditor",
    ]);
    expect(workspaceCommands.map((command) => command.enabled)).toEqual([true, true]);
    expect(filterCommands(workspaceCommands, "ide zed").map((command) => command.id)).toEqual([
      "workspace.openActiveWithEditor",
    ]);

    workspaceCommands[1].run();
    expect(opened).toEqual(["editor"]);

    expect(
      createOpenCurrentWorkspaceCommands(false, noop, noop).map((command) => command.enabled),
    ).toEqual([false, false]);
  });

  it("builds the current workspace remove command", () => {
    let removed = false;
    const removeCommand = createRemoveCurrentWorkspaceCommand(true, () => {
      removed = true;
    });

    expect(removeCommand).toMatchObject({
      id: "workspace.removeCurrent",
      title: "Remove Current Workspace",
      category: "Workspace",
      enabled: true,
    });
    expect(filterCommands([removeCommand], "delete project").map((command) => command.id)).toEqual([
      "workspace.removeCurrent",
    ]);

    removeCommand.run();
    expect(removed).toBe(true);
    expect(createRemoveCurrentWorkspaceCommand(false, noop).enabled).toBe(false);
  });

  it("builds the preview auto zoom toggle command", () => {
    const zoomModes: string[] = [];
    const enableAutoCommand = createPreviewAutoZoomCommand("manual", (zoomMode) => {
      zoomModes.push(zoomMode);
    });
    const disableAutoCommand = createPreviewAutoZoomCommand("auto", (zoomMode) => {
      zoomModes.push(zoomMode);
    });

    expect(enableAutoCommand).toMatchObject({
      id: "view.togglePreviewAutoZoom",
      title: "Enable Preview Auto Zoom",
      category: "View",
    });
    expect(disableAutoCommand.title).toBe("Disable Preview Auto Zoom");
    expect(filterCommands([enableAutoCommand], "preview auto").map((command) => command.id)).toEqual(
      ["view.togglePreviewAutoZoom"],
    );

    enableAutoCommand.run();
    disableAutoCommand.run();
    expect(zoomModes).toEqual(["auto", "manual"]);
  });

  it("builds the editor auto width toggle command", () => {
    const ratioModes: string[] = [];
    const enableAutoCommand = createEditorAutoWidthCommand("manual", (mode) => {
      ratioModes.push(mode);
    });
    const disableAutoCommand = createEditorAutoWidthCommand("auto", (mode) => {
      ratioModes.push(mode);
    });

    expect(enableAutoCommand).toMatchObject({
      id: "view.toggleEditorAutoWidth",
      title: "Enable Editor Auto Width",
      category: "View",
    });
    expect(disableAutoCommand.title).toBe("Disable Editor Auto Width");
    expect(filterCommands([enableAutoCommand], "editor auto").map((command) => command.id)).toEqual(
      ["view.toggleEditorAutoWidth"],
    );

    enableAutoCommand.run();
    disableAutoCommand.run();
    expect(ratioModes).toEqual(["auto", "manual"]);
  });
});

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace",
    name: "Workspace",
    rootPath: "/tmp/workspace",
    createdAt: "2026-05-22T00:00:00.000Z",
    lastOpenedAt: "2026-05-22T00:00:00.000Z",
    activeTabId: "tab",
    tabs: [],
    ...overrides,
  };
}
