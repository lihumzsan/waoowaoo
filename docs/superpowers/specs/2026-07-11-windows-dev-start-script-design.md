# Windows Development Start Script Design

## Goal

Provide a Windows-friendly foreground launcher in the repository root so the full development stack can be started without manually entering an npm command.

## Interface

Create `start-dev.cmd` in the repository root. It can be launched by double-clicking it in Explorer or by running it from a terminal.

The launcher keeps the console attached to the development processes so logs remain visible. Pressing `Ctrl+C` stops the `npm run dev` process tree through the existing `concurrently` lifecycle.

## Behavior

1. Switch the working directory to the directory containing the launcher, including when the repository path is on another drive.
2. Verify that `package.json` exists in that directory. If it does not, print a clear error and keep a double-clicked window open for inspection.
3. Verify that `npm.cmd` is available on `PATH`. This deliberately bypasses PowerShell's `npm.ps1` execution-policy restriction.
4. Run `npm.cmd run dev` in the foreground, delegating storage initialization and all service startup to the existing package script.
5. Return the npm exit code. If startup or execution fails, print the exit code and pause so the error remains visible.

## Scope

The launcher will not install dependencies, edit `.env`, start services in the background, detect occupied ports, or add a separate stop script. Those behaviors remain the responsibility of the existing development setup and its logs.

## Verification

Verification will cover both static and runtime behavior:

- The launcher resolves its own directory and invokes `npm.cmd run dev`.
- Missing-project and missing-npm checks produce non-zero exit codes.
- A controlled test double for `npm.cmd` confirms argument forwarding without starting a duplicate live development stack.
- The existing live development server remains reachable independently of the launcher test.
