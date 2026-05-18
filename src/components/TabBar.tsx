import { FileText, Plus, X } from "lucide-react";
import { isTabUnsaved } from "../tabs";
import type { D2Tab } from "../types";

type TabBarProps = {
  tabs: D2Tab[];
  activeTabId: string;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
};

export function TabBar({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onCreateTab,
}: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="Open D2 files">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? "tab active" : "tab"}
            title={tab.fileName}
          >
            <button
              className="tab-label"
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              onClick={() => {
                onActivateTab(tab.id);
              }}
            >
              <FileText size={14} />
              <span>{isTabUnsaved(tab) ? `${tab.fileName} *` : tab.fileName}</span>
            </button>
            <button
              className="tab-close"
              type="button"
              aria-label={`Close ${tab.fileName}`}
              title={`Close ${tab.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="tab-add" title="New tab (Command/Ctrl + T)" onClick={onCreateTab}>
        <Plus size={16} />
      </button>
    </nav>
  );
}
