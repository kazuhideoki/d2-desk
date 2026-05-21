import {
  Briefcase,
  FileText,
  type LucideIcon,
} from "lucide-react";
import type { AppCommand } from "../../shared/commands";
import type { Workspace } from "../../types";
import { RepeatButton } from "../../shared/components/RepeatButton";

export type ToolbarCommand = AppCommand & {
  icon: LucideIcon;
  toolbarGroup: number;
};

type ToolbarProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
  workspaceCommands: ToolbarCommand[];
  toolbarCommands: ToolbarCommand[];
  onRunCommand: (command: AppCommand) => void;
};

export function Toolbar({
  workspaces,
  activeWorkspaceId,
  onWorkspaceChange,
  workspaceCommands,
  toolbarCommands,
  onRunCommand,
}: ToolbarProps) {
  const orderedToolbarCommands = [...toolbarCommands].sort(
    (left, right) => left.toolbarGroup - right.toolbarGroup,
  );

  return (
    <header className="topbar">
      <div className="brand">
        <FileText size={20} />
        <span>D2 Desk</span>
      </div>
      <div className="workspace-switcher">
        <Briefcase size={16} />
        <select
          aria-label="Workspace"
          value={activeWorkspaceId ?? ""}
          onChange={(event) => onWorkspaceChange(event.target.value || null)}
        >
          <option value="">No Workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        {workspaceCommands.map((command) => {
          const Icon = command.icon;
          return (
            <button
              key={command.id}
              title={command.shortcut ? `${command.title} (${command.shortcut})` : command.title}
              onClick={() => onRunCommand(command)}
              disabled={command.enabled === false}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>
      <div className="toolbar" role="toolbar">
        {orderedToolbarCommands.map((command, index) => {
          const Icon = command.icon;
          const previousCommand = orderedToolbarCommands[index - 1];
          const shouldShowDivider =
            previousCommand !== undefined && previousCommand.toolbarGroup !== command.toolbarGroup;
          return (
            <div className="toolbar-command" key={command.id}>
              {shouldShowDivider ? <span className="divider" /> : null}
              {command.id === "view.zoomOut" || command.id === "view.zoomIn" ? (
                <RepeatButton
                  title={
                    command.shortcut ? `${command.title} (${command.shortcut})` : command.title
                  }
                  onPress={() => onRunCommand(command)}
                  disabled={command.enabled === false}
                >
                  <Icon size={16} />
                </RepeatButton>
              ) : (
                <button
                  title={
                    command.shortcut ? `${command.title} (${command.shortcut})` : command.title
                  }
                  onClick={() => onRunCommand(command)}
                  disabled={command.enabled === false}
                >
                  <Icon size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </header>
  );
}
