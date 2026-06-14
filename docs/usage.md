# Usage Guide

## Getting started

Launch the dashboard from a pi TUI session:

```text
/agents
```

The dashboard shows an agent list on the left and mode-specific details on the right.

## Dashboard modes

Use direct mode keys to switch views:

- `G`: **AGENTS** mode for job management.
- `T`: **TRACKING** mode for worker progress, messages, tool events, and final responses.
- `P`: **APPROVALS** mode for pending agent-scoped tool approvals.
- `F`: **ARTIFACTS** mode for proposals, notes, and generated files.
- `H` or `?`: **HELP** mode.
- `Q` / `E`: Walk backward or forward through modes.
- `Esc` or `Ctrl-C`: Close the dashboard.

## Job management

In **AGENTS** mode:

- `C`: Create a new job.
- `S`: Start the selected job.
- `X`: Abort the selected running job.
- `K`: Clear selected-agent output after confirmation.
- `Delete` or `Backspace`: Delete the selected job after confirmation.
- `1`-`9`: Select an agent job.

A job that has already produced output cannot be started again from a blank state until it is cleared. Use **TRACKING** mode to continue it with a follow-up message instead.

## Tracking and follow-up messages

In **TRACKING** mode:

- `M`: Send a follow-up message to the selected agent.
- `Up` / `Down`: Scroll the right-hand panel.

Tracking entries summarize worker starts, user messages, tool calls, errors, and final responses.

## Approvals

In **APPROVALS** mode:

- `A`: Approve the first pending agent-scoped tool approval.
- `N`: Deny the first pending agent-scoped tool approval.

Approvals are for policy-controlled tool calls, such as sensitive commands. They are separate from accepting proposal artifacts into the project.

## Artifacts and proposal acceptance

In **ARTIFACTS** mode:

- `[` / `]`: Move between visible artifacts and notes.
- `O` or `Enter`: Open the selected artifact in the large viewer.
- `V`: Hide or show note artifacts.
- `R`: Refresh artifact discovery.
- `Up` / `Down`: Scroll the right-hand panel.

The artifact viewer supports:

- `D`: Show a diff for proposal artifacts.
- `P`: Show the proposal or raw artifact content.
- `O`: Show the original file for proposal artifacts.
- `A`: Start proposal acceptance. Press `A` again to confirm.
- `W`: Toggle wrapping.
- `Up` / `Down`: Scroll.
- `PageUp` / `PageDown`: Jump between changed lines in diff view, or page through raw content.
- `Q` or `Esc`: Close the viewer.

Only proposal artifacts with a final project path can be accepted. Notes and general artifacts are review-only.

## Typical workflow

1. Open `/agents`.
2. Press `C` in **AGENTS** mode to create a focused job.
3. Press `S` to start the selected worker.
4. Watch progress in **TRACKING** mode.
5. Review generated proposals and notes in **ARTIFACTS** mode.
6. Open a proposal, inspect the diff, and press `A` twice in the artifact viewer if you want to apply it.
7. Use `M` in **TRACKING** mode to send follow-up instructions when more work is needed.
