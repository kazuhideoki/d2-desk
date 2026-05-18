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

export const themes = [
  { id: 4, label: "Grape" },
  { id: 0, label: "Neutral" },
  { id: 100, label: "Terminal" },
  { id: 101, label: "Origami" },
];

export const baseEditorFontSize = 14;
export const baseEditorLineHeight = 20;
export const minZoom = 0.4;
export const maxZoom = 2.2;
export const zoomStep = 0.1;
export const tabsStorageKey = "d2-desk:tabs";
export const workspacesStorageKey = "d2-desk:workspaces";
