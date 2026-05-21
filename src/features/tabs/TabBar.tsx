import { useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { FileText, Plus, X } from "lucide-react";
import { hasTabPendingUserChanges, type TabDropPosition } from "./tabs";
import type { D2Tab } from "../../types";

type TabBarProps = {
  tabs: D2Tab[];
  activeTabId: string;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
  onReorderTabs: (draggedTabId: string, targetTabId: string, position: TabDropPosition) => void;
};

export function TabBar({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onCreateTab,
  onReorderTabs,
}: TabBarProps) {
  const [dragState, setDragState] = useState<{
    tabId: string;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    tabId: string;
    position: TabDropPosition;
  } | null>(null);
  const draggedTabId = dragState?.tabId ?? null;

  function dropTargetFromPoint(
    clientX: number,
    clientY: number,
    sourceTabId: string,
  ): { tabId: string; position: TabDropPosition } | null {
    const targetElement = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-tab-id]");
    const tabId = targetElement?.dataset.tabId;
    if (!targetElement || !tabId || tabId === sourceTabId) return null;

    const bounds = targetElement.getBoundingClientRect();
    const position = clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    return { tabId, position };
  }

  function updateDropTarget(event: PointerEvent<HTMLDivElement>, sourceTabId: string) {
    setDropTarget(dropTargetFromPoint(event.clientX, event.clientY, sourceTabId));
  }

  function hasDragged(clientX: number, clientY: number) {
    return (
      dragState &&
      (Math.abs(clientX - dragState.startX) > 4 || Math.abs(clientY - dragState.startY) > 4)
    );
  }

  function updateMouseDrag(event: MouseEvent<HTMLDivElement>) {
    if (!dragState) return;
    if (!dragState.isDragging && hasDragged(event.clientX, event.clientY)) {
      setDragState({ ...dragState, isDragging: true });
    }
    setDropTarget(dropTargetFromPoint(event.clientX, event.clientY, dragState.tabId));
  }

  function finishMouseDrag(event: MouseEvent<HTMLDivElement>) {
    if (!dragState) return;
    const target = dropTargetFromPoint(event.clientX, event.clientY, dragState.tabId) ?? dropTarget;
    const sourceTabId = dragState.tabId;
    const wasDragging = dragState.isDragging || hasDragged(event.clientX, event.clientY);
    resetDragState();
    if (wasDragging && target && sourceTabId !== target.tabId) {
      event.preventDefault();
      onReorderTabs(sourceTabId, target.tabId, target.position);
    }
  }

  function resetDragState() {
    setDragState(null);
    setDropTarget(null);
  }

  return (
    <nav className="tabbar" aria-label="Open D2 files">
      <div
        className="tabs"
        role="tablist"
        onMouseMove={updateMouseDrag}
        onMouseUp={finishMouseDrag}
        onMouseLeave={() => {
          if (dragState?.isDragging) {
            setDropTarget(null);
          }
        }}
      >
        {tabs.map((tab) => {
          const isUnsaved = hasTabPendingUserChanges(tab);
          const isDragging = tab.id === draggedTabId;
          const dropPosition =
            dropTarget?.tabId === tab.id && draggedTabId !== tab.id ? dropTarget.position : null;
          const className = [
            "tab",
            tab.id === activeTabId ? "active" : "",
            isDragging ? "dragging" : "",
            dropPosition ? `drop-${dropPosition}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={tab.id}
              className={className}
              data-tab-id={tab.id}
              title={tab.fileName}
              onPointerDown={(event) => {
                if (tabs.length <= 1) {
                  event.preventDefault();
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragState({
                  tabId: tab.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  isDragging: false,
                });
              }}
              onMouseDown={(event) => {
                if (tabs.length <= 1) return;
                setDragState({
                  tabId: tab.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  isDragging: false,
                });
              }}
              onPointerMove={(event) => {
                if (!dragState || dragState.tabId !== tab.id) return;

                const hasMoved =
                  Math.abs(event.clientX - dragState.startX) > 4 ||
                  Math.abs(event.clientY - dragState.startY) > 4;
                if (!dragState.isDragging && hasMoved) {
                  setDragState({ ...dragState, isDragging: true });
                  updateDropTarget(event, dragState.tabId);
                  return;
                }
                updateDropTarget(event, dragState.tabId);
              }}
              onPointerUp={(event) => {
                const sourceTabId = dragState?.tabId ?? null;
                const target = sourceTabId
                  ? (dropTargetFromPoint(event.clientX, event.clientY, sourceTabId) ?? dropTarget)
                  : null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                resetDragState();
                if (sourceTabId && target && sourceTabId !== target.tabId) {
                  event.preventDefault();
                  onReorderTabs(sourceTabId, target.tabId, target.position);
                }
              }}
              onPointerCancel={resetDragState}
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
                <span className="tab-unsaved-indicator" aria-hidden="true">
                  {isUnsaved ? <span /> : null}
                </span>
                <FileText size={14} />
                <span className="tab-file-name">{tab.fileName}</span>
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
          );
        })}
      </div>
      <button className="tab-add" title="New tab (Command/Ctrl + T)" onClick={onCreateTab}>
        <Plus size={16} />
      </button>
    </nav>
  );
}
