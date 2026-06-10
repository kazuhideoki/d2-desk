import type { AppCommand } from "../../shared/commands";
import type { Workspace } from "../../types";

type PreviewZoomMode = "auto" | "manual";

function normalizeCommandQuery(value: string) {
  return value.trim().toLowerCase();
}

function commandSearchFields(command: AppCommand) {
  return [
    command.id,
    command.title,
    command.category,
    command.shortcut ?? "",
    ...(command.keywords ?? []),
  ].map((value) => value.toLowerCase());
}

function commandSearchText(command: AppCommand) {
  return commandSearchFields(command).join(" ");
}

function compactCommandSearchText(value: string) {
  return value.replace(/[^a-z0-9]/g, "");
}

function subsequenceMatchScore(query: string, text: string) {
  let queryIndex = 0;
  let previousMatchIndex = -1;
  let score = 0;

  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) continue;

    score += textIndex;
    if (previousMatchIndex >= 0) {
      score += textIndex - previousMatchIndex - 1;
    }
    previousMatchIndex = textIndex;
    queryIndex += 1;
  }

  return queryIndex === query.length ? score : Number.POSITIVE_INFINITY;
}

function commandTokenMatchScore(token: string, text: string, compactFields: string[]) {
  const exactIndex = text.indexOf(token);
  if (exactIndex >= 0) return exactIndex;

  const compactToken = compactCommandSearchText(token);
  if (!compactToken) return Number.POSITIVE_INFINITY;

  const compactIndex = Math.min(
    ...compactFields
      .map((compactField) => compactField.indexOf(compactToken))
      .filter((index) => index >= 0),
  );
  if (Number.isFinite(compactIndex)) return compactIndex + 25;

  const subsequenceScore = Math.min(
    ...compactFields.map((compactField) => subsequenceMatchScore(compactToken, compactField)),
  );
  return Number.isFinite(subsequenceScore) ? subsequenceScore + 50 : Number.POSITIVE_INFINITY;
}

function commandMatchScore(command: AppCommand, query: string) {
  if (!query) return 0;

  const text = commandSearchText(command);
  const title = command.title.toLowerCase();
  const compactFields = commandSearchFields(command).map(compactCommandSearchText);
  const tokens = query.split(/\s+/).filter(Boolean);
  const tokenScores = tokens.map((token) => commandTokenMatchScore(token, text, compactFields));
  if (tokenScores.some((score) => !Number.isFinite(score))) {
    return Number.POSITIVE_INFINITY;
  }

  let score = text.length;
  if (title === query) score -= 1000;
  if (title.startsWith(query)) score -= 700;
  if (command.id.toLowerCase() === query) score -= 600;
  score += tokenScores.reduce((total, tokenScore) => total + tokenScore, 0);
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
