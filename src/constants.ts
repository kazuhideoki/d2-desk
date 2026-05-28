export const sampleSource = `direction: right

user: User {
  shape: person
}

api: API Server {
  shape: hexagon
}

db: Database {
  shape: cylinder
}

queue: Queue {
  shape: queue
}

user -> api: request
api -> db: query
api -> queue: enqueue
queue -> db: persist`;

export const baseEditorFontSize = 14;
export const baseEditorLineHeight = 20;
export const minZoom = 0.1;
export const minAutoZoom = 0.01;
export const maxZoom = 10;
export const zoomStep = 0.1;
export const zoomStepAbove200 = 0.2;
export const fineZoomStep = 0.01;
export const tabsStorageKey = "d2-desk:tabs";
export const workspacesStorageKey = "d2-desk:workspaces";
<<<<<<< HEAD
export const bottomPanelVisibilityStorageKey = "d2-desk:bottom-panel-visible";
=======
export const previewLayoutStorageKey = "d2-desk:preview-layout";
>>>>>>> feat/persist-preview-mode
