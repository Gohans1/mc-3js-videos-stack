# Fixing AI Studio UI Changes

All UI selectors live in `scripts/page-map.ts` (known exceptions are documented in [development.md](development.md)), so when AI Studio's UI changes you normally edit only `page-map.ts`. Stay strictly inside Playground (`/prompts`) and History (`/library`). Run commands from the repo root (`STUDIO = bun .claude/skills/aistudio/scripts/studio.ts`).

## Recovery Procedure

| Step | Action |
| --- | --- |
| 1. Diagnose | Run `STUDIO --tab doctor doctor` (~30s, zero model quota). It visits each page state and reports every entry. |
| 2. Read status | `✓` matched first candidate; `⚠` fell back to a secondary candidate (fix soon); `✗` broken; `·` absent and allowed (`optional: true`). |
| 3. Reach target state | Use `STUDIO open new`, `open <link>`, `model ...`, or `STUDIO ab click` to open the picker, dialog, or menu named in the entry's `where` field. |
| 4. Inspect DOM | Run `STUDIO ab snapshot -i` for ARIA roles/names, `STUDIO screenshot x.png` for visual state, and `STUDIO ab eval "..."` for `data-test-id`, `aria-label`, and `ms-*` tags. |
| 5. Pick stronger locator | Follow the stability priority below. Prepend the new candidate and keep the old one as a fallback if it may return. |
| 6. Re-verify | `STUDIO --tab doctor doctor` must report zero `✗` and zero `⚠`, then run `STUDIO --tab smoke smoke`. |
| 7. Record lessons | Log new page quirks in the traps table of [development.md](development.md). Update `TEXT` or `URLS` in `page-map.ts` if page copy or routes changed. |

## Locator Stability Priority

| Priority | Candidate Type | Example | Why |
| --- | --- | --- | --- |
| 1 | `testId` | `{ testId: "model-name" }` | Google's own `data-test-id` test hook; rarely changes. |
| 2 | `role` + `name` | `{ role: "button", name: "Edit video options" }` | Screen-reader accessible name; changes break accessibility so Google keeps it stable. Requires English UI. |
| 3 | `role` + regex `name` | `{ role: "button", name: { re: "^(Run\|Stop)$" } }` | Use when labels contain dynamic parts. |
| 4 | `css` | `{ css: "ms-chat-turn" }` | Angular custom element or Material class; changes on refactors. Last resort when ARIA is absent. |

Accessible names are resolved in order: `aria-label`, `aria-labelledby`, `<label>`, visible text (excluding `aria-hidden` icons), `title`, `placeholder` (matching `agent-browser snapshot`). Roles must be explicit or listed in the implicit role table in `RUNTIME_SOURCE` (`scripts/lib.ts`), so other implicit roles visible in `snapshot -i` may not match.

## Adding an Entry to `MAP`

| Field | Convention |
| --- | --- |
| Key name | `camelCase`, named after intent (`systemInstructions`), never layout position. |
| `what` | One sentence describing the element and any quirks (e.g., virtualized until near viewport). |
| `where` | Page state checked by `doctor`: `chat`, `chat-turns`, `video-chip`, `video-dialog`, `model-picker`, `library`, `turn-menu`, `rename-dialog`, `system-panel`. Add any new state to `Where` and `doctor` in `studio.ts`. |
| `candidates` | Most stable locator first. |
| `optional` | Only when absence is normal; document why (e.g., model without thoughts). |

Data-driven elements (dropdown options, tool switches) use dynamic lookup rather than `MAP`. For new tools, add an alias in `TOOLS` (checked automatically by `doctor`); model-specific tools go in `TOOLS_SOME_MODELS`.

## When `doctor` Cannot Reach a State

| Error | Likely Cause |
| --- | --- |
| `new chat page: NOT OK ... prompt box never appeared` | `promptBox` broke (sign-out says `signed out`). Check failure screenshot. |
| `model picker: did not open` | `modelName` broke (opener button wraps it). |
| `video chip / dialog: covered by cdk-overlay-backdrop` | Another panel or dialog is open on top; dismiss it first. |
| `options button stays covered` or `options menu did not open` | Turn options appear only while hovering the turn, and toasts can obscure them; video-only turns lack `Copy as markdown`. Inspect `openTurnMenu` in `scripts/lib.ts`. |
| `turn n never rendered its content` | Virtualized turn; `turnBody` broke or `showTurn` failed to scroll it into view. |
| Dialog stays open after Save | AI Studio rejected a value; inspect `dialogError` text. |
| `timed out after N s` | Target state never appeared (chip, History, rename dialog): entry broke or page stalled. Check failure screenshot. |
| `page language is ...` | Google account is not set to English, shifting all ARIA labels. Switch account language to English. |
