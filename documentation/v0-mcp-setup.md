# v0 MCP Setup

This repo is prepared so v0 can be used as a UI generation layer while Codex remains responsible for integration, business logic, data wiring, and validation.

## Intended Workflow

1. Ask Codex for a UI change.
2. Codex sends the UI task to v0 through MCP.
3. v0 generates or revises the UI.
4. Codex adapts the result to this real codebase.
5. Codex runs `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

Do not use v0 as the final authority for:

- Mollie flows
- payment safety behavior
- auth decisions
- webhook logic
- reconciliation logic
- mode-selection semantics

Use v0 for:

- page layout
- interaction design
- component structure
- spacing and hierarchy
- shadcn-based UI generation

## User-Side MCP Connection

Use the official v0 MCP endpoint:

- `https://mcp.v0.dev`

When you connect the MCP in your editor/app, point it there.

Official references:

- v0 MCP server docs
- v0 project docs
- v0 design systems docs

## v0 Project Setup

Inside v0, create a dedicated project for this app, for example:

- `Mollie Manager`

Then add durable project context under project settings.

### Rules

Paste the contents of:

- `documentation/v0-project-rules.md`

### Sources

Upload these files as project sources:

- `documentation/ai-handoff.md`
- `documentation/v0-project-rules.md`
- `documentation/v0-ui-brief.md`
- `components.json`
- `app/globals.css`
- `app/(dashboard)/layout.tsx`
- `app/(dashboard)/page.tsx`
- any page/component you want redesigned

## Repo Conventions v0 Should Work Against

- This app uses Next.js App Router.
- This app uses Tailwind CSS v4.
- This repo is now shadcn-ready via `components.json`.
- Shared UI primitives should go in `components/ui`.
- App-specific composed components should stay in `components`.
- Preserve server actions and data access boundaries.

## Local Commands

These are the commands Codex should keep using after v0-generated UI work:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

To add more shadcn components locally:

```bash
npm run ui:add -- button
```
