import type { AppCommand } from "../../shared/commands";
import type { Workspace } from "../../types";

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
