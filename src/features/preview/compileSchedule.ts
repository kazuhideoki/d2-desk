type PreviewCompileDelayParams = {
  tabChanged: boolean;
  boardChanged: boolean;
  editDelayMs: number;
  tabSwitchDelayMs: number;
};

export function getPreviewCompileDelayMs({
  tabChanged,
  boardChanged,
  editDelayMs,
  tabSwitchDelayMs,
}: PreviewCompileDelayParams) {
  if (tabChanged) return tabSwitchDelayMs;
  if (boardChanged) return 0;
  return editDelayMs;
}
