import type { AppCommand } from "../../shared/commands";
import type { Workspace } from "../../types";

type PreviewZoomMode = "auto" | "manual";
type EditorPaneRatioMode = "auto" | "manual";

function normalizeCommandQuery(value: string) {
  return value.trim().toLowerCase();
}

function commandSearchText(command: AppCommand) {
  return [
    command.id,
    command.title,
    command.category,
    command.shortcut ?? "",
    ...(command.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function commandMatchScore(command: AppCommand, query: string) {
  if (!query) return 0;

  const text = commandSearchText(command);
  const title = command.title.toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.some((token) => !text.includes(token))) {
    return Number.POSITIVE_INFINITY;
  }

  let score = text.length;
  if (title === query) score -= 1000;
  if (title.startsWith(query)) score -= 700;
  if (command.id.toLowerCase() === query) score -= 600;
  score += tokens.reduce((total, token) => total + text.indexOf(token), 0);
  return score;
}

export function filterCommands(commands: AppCommand[], query: string) {
  const normalizedQuery = normalizeCommandQuery(query);
  return commands
    .map((command, index) => ({
      command,
      index,
      score: commandMatchScore(command, normalizedQuery),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.index - right.index;
    })
    .map((item) => item.command);
}

export function createWorkspaceSelectionCommands(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
  onSelectWorkspace: (workspaceId: string | null) => void | Promise<void>,
): AppCommand[] {
  const noWorkspaceCommand: AppCommand = {
    id: "workspace.select.none",
    title: "No Workspace",
    category: "Workspace",
    keywords: ["select", "switch", "change", "project", "folder", "none"],
    enabled: activeWorkspaceId !== null,
    run: () => onSelectWorkspace(null),
  };

  return [
    noWorkspaceCommand,
    ...workspaces.map((workspace) => ({
      id: `workspace.select.${workspace.id}`,
      title: workspace.name,
      category: "Workspace" as const,
      keywords: [
        "select",
        "switch",
        "change",
        "project",
        "folder",
        workspace.name,
        workspace.rootPath,
      ],
      enabled: workspace.id !== activeWorkspaceId,
      run: () => onSelectWorkspace(workspace.id),
    })),
  ];
}

export function createOpenCurrentWorkspaceCommands(
  hasActiveWorkspace: boolean,
  onOpenInFinder: () => void | Promise<void>,
  onOpenWithEditor: () => void | Promise<void>,
): AppCommand[] {
  return [
    {
      id: "workspace.openActiveInFinder",
      title: "Open Current Workspace in Finder",
      category: "Workspace",
      keywords: ["current", "active", "finder", "folder", "directory", "reveal", "show"],
      enabled: hasActiveWorkspace,
      run: onOpenInFinder,
    },
    {
      id: "workspace.openActiveWithEditor",
      title: "Open Current Workspace with $EDITOR",
      category: "Workspace",
      keywords: [
        "current",
        "active",
        "ide",
        "editor",
        "external",
        "zed",
        "folder",
        "directory",
        "project",
      ],
      enabled: hasActiveWorkspace,
      run: onOpenWithEditor,
    },
  ];
}

export function createRemoveCurrentWorkspaceCommand(
  hasActiveWorkspace: boolean,
  onRemoveCurrentWorkspace: () => void | Promise<void>,
): AppCommand {
  return {
    id: "workspace.removeCurrent",
    title: "Remove Current Workspace",
    category: "Workspace",
    keywords: [
      "current",
      "active",
      "delete",
      "remove",
      "unregister",
      "folder",
      "directory",
      "project",
    ],
    enabled: hasActiveWorkspace,
    run: onRemoveCurrentWorkspace,
  };
}

export function createPreviewAutoZoomCommand(
  previewZoomMode: PreviewZoomMode,
  onZoomModeChange: (zoomMode: PreviewZoomMode) => void,
): AppCommand {
  const nextZoomMode = previewZoomMode === "auto" ? "manual" : "auto";

  return {
    id: "view.togglePreviewAutoZoom",
    title:
      previewZoomMode === "auto" ? "Disable Preview Auto Zoom" : "Enable Preview Auto Zoom",
    category: "View",
    keywords: ["preview", "auto", "fit", "scale", "zoom"],
    run: () => onZoomModeChange(nextZoomMode),
  };
}

export function createEditorAutoWidthCommand(
  editorPaneRatioMode: EditorPaneRatioMode,
  onEditorPaneRatioModeChange: (mode: EditorPaneRatioMode) => void,
): AppCommand {
  const nextMode = editorPaneRatioMode === "auto" ? "manual" : "auto";

  return {
    id: "view.toggleEditorAutoWidth",
    title:
      editorPaneRatioMode === "auto" ? "Disable Editor Auto Width" : "Enable Editor Auto Width",
    category: "View",
    keywords: ["editor", "auto", "width", "divider", "layout", "pane"],
    run: () => onEditorPaneRatioModeChange(nextMode),
  };
}
