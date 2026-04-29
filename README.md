# D2 Desk

## Development

Install dependencies once:

```sh
npm install
```

Use the isolated Tauri dev command for normal feature work:

```sh
npm run tauri:dev
```

This starts Tauri with an isolated app identifier, binary name, Cargo target
directory, sidecar binary, window title, and Vite dev port. It lets multiple git
worktrees run side by side without sharing the same `localhost:1420` dev server,
macOS app identity, dev build output, or watched repository files.

You can pin the values when needed:

```sh
D2_DESK_DEV_PORT=1430 D2_DESK_DEV_SUFFIX=feature-a npm run tauri:dev
```

The lower-level commands are still available:

```sh
npm run dev        # Vite-only browser dev server
npm run tauri dev  # Tauri dev with the default app identity and port
npm run build:app  # sidecar + frontend production build
```
