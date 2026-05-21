export type CommandCategory = "Workspace" | "File" | "Edit" | "View" | "Export";

export type AppCommand = {
  id: string;
  title: string;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  enabled?: boolean;
  run: () => void | Promise<void>;
};

export function isCommandEnabled(command: AppCommand) {
  return command.enabled !== false;
}
