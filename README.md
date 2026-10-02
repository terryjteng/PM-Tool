# Throughline

A project planning tool: roadmap, Gantt timeline with critical path and baselines, backlog and sprint planning, sprint board, burndown and burnup charts, an implementation plan for PM tasks, retrospectives, a RAID log, flow metrics (control chart, Cpk, Monte Carlo), and Scrum Master, Agile Coach, and Lean Six Sigma coaches with optional Claude chat.

Built with React 19, TypeScript, Vite, Zustand + Immer (state with undo/redo), and dnd-kit (drag and drop).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds to dist/
npm run preview    # serves the production build
```

`dist/` is static and can be hosted anywhere (Vercel, Netlify, GitHub Pages, S3). It uses relative paths, so it also works from a subfolder.

## Data

Everything is saved in the browser's localStorage under `throughline:v3`. Projects saved by the old single-file version (`throughline:v2`) are migrated automatically on first load; the old copy is left in place. Use **Settings → Your data** to download a JSON backup, import one, or export tickets as CSV.

The coach chats are optional and use the viewer's own Anthropic API key, stored only in their browser and sent only to `api.anthropic.com` along with a snapshot of the current project.

## Layout

| Path | What it holds |
| --- | --- |
| `src/model/types.ts` | Data model |
| `src/model/store.ts` | Data store: undo/redo, debounced persistence, migration |
| `src/model/ui.ts` | UI state, hash routing (`#/<projectId>/<view>`), toasts, modals |
| `src/model/selectors.ts` | Velocity, burndown, forecasts, milestone status, attention items |
| `src/model/flow.ts` | Cycle time, XmR limits, Cpk, CFD, Pareto, Monte Carlo, critical path |
| `src/model/coaches.ts` | Rule-based coach checks (each can be switched off in Settings) and generated briefs |
| `src/model/ai.ts` | Claude connection, coach prompts, project snapshot, streaming chat |
| `src/components/` | UI primitives, charts, forms, drag and drop |
| `src/views/` | One file per area of the app |
| `legacy/` | The original single-file HTML version, kept for reference |

## Keyboard

`Ctrl K` command palette · `N` new ticket · `Ctrl Z` / `Ctrl Shift Z` undo / redo · `Ctrl Enter` save a form · `Esc` close
