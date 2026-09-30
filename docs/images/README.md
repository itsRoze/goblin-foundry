# README screenshots

These are actual captures of the built app, using fictional Fieldnotes data in a disposable SQLite database. No personal tracker data is included.

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
bunx playwright install chromium
bun scripts/screenshots.ts
```

The script starts a localhost server on an available port, captures the project, expanded graph, and board, then closes the browser and removes its temporary database. It uses the database seam to install synthetic fixtures; it does not advance tickets in a live tracker.
