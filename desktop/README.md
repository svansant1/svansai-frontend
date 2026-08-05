# SVANS-AI Desktop

SVANS-AI Desktop turns the existing SVANS-AI web app into a local command center with a secure desktop bridge.

## What this adds

- Electron desktop shell
- Secure preload bridge exposed as `window.svansDesktop`
- Permission-scoped workspace selection
- Read-only or trusted workspace modes
- Folder tree scanning with ignored heavy folders
- Safe file read inside the approved workspace
- Trusted-mode file write with automatic backup files
- Allowlisted local command runner
- Local audit log at the Electron user-data directory
- Collapsible Desktop Command Center in the SVANS-AI interface
- Desktop capability registry
- Git status, branch, diff, and log helpers
- Workspace summary and text search
- File write preview metadata before trusted writes
- Audit log viewer

## Commands

```powershell
npm run desktop:dev
```

Runs SVANS-AI in the desktop shell during development. Start `npm run dev` first if you want to use the normal Next dev server.

```powershell
npm run desktop
```

Starts the desktop shell.

```powershell
npm run desktop:pack
```

Builds the Next app and creates an unpacked desktop build.

```powershell
npm run desktop:dist
```

Builds the Next app and creates a Windows installer through Electron Builder.

## Permission model

The desktop bridge has three practical states:

- `none`: no folder access
- `read`: selected-folder read access, folder scan, file read, and command runs
- `trusted`: selected-folder read/write access with backups before writes

The bridge never grants broad C-drive access by default. A selected folder is resolved and checked before every file action so paths cannot escape the approved workspace.

## Command model

The first command allowlist is:

- `node`
- `npm`
- `npx`
- `git`
- `python`
- `python3`
- `powershell`
- `pwsh`

Commands run inside the approved workspace. This is intentionally powerful but still scoped.

## Capability registry

`desktop/capabilities.cjs` defines the desktop capability catalog. The UI reads it through `window.svansDesktop.listCapabilities()` and displays each capability with:

- category
- status
- permission requirement
- description

Statuses currently mean:

- `available`: working in the desktop bridge now
- `configured`: available through existing backend/API configuration
- `partial`: useful support exists, but deeper native desktop tooling can still be added
- `planned`: intentionally listed as a future expansion point

## Audit log

Every sensitive desktop action writes a JSONL audit event:

- app start/stop
- workspace selection/clear
- folder scans
- file reads
- file writes
- command runs

This gives SVANS-AI, Shield, VOS, Debugger, and Sandbox a real event trail to reason from.

## Next upgrade points

- Add patch preview/apply workflow
- Add built-in terminal panel
- Add VOS project index database
- Add command approval modal before destructive commands
- Add Shield policy scanner for secrets and risky file edits
- Add Sandbox worktree creation for isolated changes
- Connect chat prompts directly to desktop tools
- Add local model/provider routing panel
- Add external connector login panels for calendar/email/cloud storage
