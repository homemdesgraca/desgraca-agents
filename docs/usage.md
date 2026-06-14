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
- `O`: **ORCHESTRATOR** mode for planning sessions and worker drafts.
- `T`: **TRACKING** mode for worker progress, messages, tool events, and final responses.
- `P`: **APPROVALS** mode for pending agent-scoped tool approvals.
- `F`: **ARTIFACTS** mode for proposals, notes, and generated files.
- `H` or `?`: **HELP** mode.
- `Q` / `E`: Walk backward or forward through modes.
- `Esc` or `Ctrl-C`: Close the dashboard.

## Job management

In **AGENTS** mode:

- `C`: Create a new job.
- `I`: Edit a draft job's name, task, and model.
- `S`: Start the selected job.
- `U`: Start the selected orchestrator parallel group after confirmation.
- `X`: Abort the selected running job.
- `K`: Clear selected-agent output after confirmation.
- `Delete` or `Backspace`: Delete the selected job after confirmation.
- `1`-`9`: Select an agent job.

A job that has already produced output cannot be started again from a blank state until it is cleared. Use **TRACKING** mode to continue it with a follow-up message instead.

Orchestrator-created agents with the same session and numeric `order` are shown together as a parallel group in **AGENTS** mode. Select any member of the group and press `U` to review a focused confirmation overlay. The overlay lists agents that will start and agents that will be skipped because they are not runnable, such as already-running workers, finished workers, workers with artifacts, or workers with pending approvals. Confirming starts the runnable members only. Groups with 4 or more members show an additional large-group warning before anything starts.

## Orchestrator mode

In **ORCHESTRATOR** mode, you manage planning sessions that coordinate worker agents:

- `C`: Create a new orchestrator session with a title, optional initial prompt, and model picker.
- `M`: Send a message to the active orchestrator session.
- `B`: Create a fresh conversation thread under the selected orchestrator for context-free discussion.
- `1`-`9`: Select an orchestrator session.
- `S` or `Enter`: Approve a pending orchestrator start request through confirmation.
- `N`: Deny a pending orchestrator start request through confirmation.
- `I`: Edit the active orchestrator session title and model.
- `X`: Abort the active running orchestrator session.
- `K`: Clear the active orchestrator session's plan, transcript, drafts, and start requests without deleting linked worker jobs.
- `Delete` or `Backspace`: Delete the active orchestrator session without deleting linked worker jobs.
- `↑` / `↓`: Scroll the orchestrator detail panel.

The orchestrator can:

- Update the session plan.
- Create ordered worker drafts with only `name`, `task`, and `order`.
- Request that a worker order start. If one worker has that order, it requests that worker; if multiple workers share the order, it requests the same-order group.
- List worker statuses and get details for specific workers.
- Create and edit session notes.
- Suggest artifact edits (review-only suggestions attached to worker artifacts).

The orchestrator cannot directly edit project files, approve worker tool calls, or apply artifacts. Worker starts require explicit user approval.

## Start request flow

When an orchestrator requests to start a worker order:

1. A prominent **ACTION REQUIRED** pending start request appears in ORCHESTRATOR mode.
2. Press `S` or `Enter` to open a focused approval overlay, or `N` to open a focused denial overlay.
3. On approval, runnable requested workers start through the normal parent runner. If the order contains multiple workers, the overlay lists runnable and skipped members before anything starts.
4. On denial, the request is marked denied and no workers start.

Approvals and denials use dashboard overlays, not inline prompts. Worker tool approvals remain separate from orchestrator start requests.

## Tracking and follow-up messages

In **TRACKING** mode:

- `M`: Send a follow-up message to the selected agent.
- `↑` / `↓`: Scroll the right-hand panel.

Tracking entries summarize worker starts, user messages, tool calls, errors, and final responses.

## Approvals

In **APPROVALS** mode:

- `A`: Approve the first pending agent-scoped tool approval.
- `N`: Deny the first pending agent-scoped tool approval.

Approvals are for policy-controlled tool calls, such as sensitive commands. They are separate from accepting proposal artifacts into the project.

## Artifacts and proposal acceptance

In **ARTIFACTS** mode:

- `[` / `]`: Move between visible artifacts and notes.
- `Enter`: Open the selected artifact in the large viewer.
- `V`: Hide or show note artifacts.
- `R`: Refresh artifact discovery.
- `↑` / `↓`: Scroll the right-hand panel.

The artifact viewer supports:

- `D`: Show a diff for proposal artifacts.
- `P`: Show the proposal or raw artifact content.
- `O`: Show the original file for proposal artifacts.
- `A`: Start proposal acceptance. Press `A` again to confirm.
- `W`: Toggle wrapping.
- `PageUp` / `PageDown`: Jump between changed lines in diff view, or page through raw content.
- `Q` or `Esc`: Close the viewer.

Only proposal artifacts with a final project path can be accepted. Notes and general artifacts are review-only.

Orchestrator artifact suggestions appear in the selected artifact details. To fuse a suggestion:

1. Open the artifact with `Enter`.
2. Press `S` to inspect suggestions.
3. Select the suggestion and press `A` twice to fuse it into the artifact.

## Typical workflow

1. Open `/agents`.
2. Press `C` in **AGENTS** mode to create a focused job.
3. Press `S` to start the selected worker.
4. Watch progress in **TRACKING** mode.
5. Review generated proposals and notes in **ARTIFACTS** mode.
6. Open a proposal, inspect the diff, and press `A` twice in the artifact viewer if you want to apply it.
7. Use `M` in **TRACKING** mode to send follow-up instructions when more work is needed.

## Orchestrator workflow

1. Open `/agents` and press `O` to enter ORCHESTRATOR mode.
2. Press `C` to create a new orchestrator session with a title and model.
3. Press `M` to send an initial prompt or wait for the orchestrator to respond.
4. Ask the orchestrator to create worker drafts with specific tasks and order. Workers with the same order are intended to be parallelizable.
5. Switch to **AGENTS** mode to review the drafted workers.
6. Edit worker models or tasks if needed using `I`.
7. To run a same-order group yourself, select one member and press `U`, then confirm the runnable members.
8. To let the orchestrator request starts, return to ORCHESTRATOR mode and ask it to start the next order.
9. Approve start requests with `S` after reviewing the overlay.
10. Monitor progress in **TRACKING** mode.
11. Review artifacts and proposals as they are generated.

## Settings

Use `/agent-settings` to configure:

- Worker tool policies (allow/ask/deny).
- Orchestrator tool policies.
- Default agent model for orchestrator-created workers.

The default model setting determines which model orchestrator-created workers use:

- `default`: Uses the same model as the orchestrator session.
- A specific model: Uses that model for all orchestrator-created workers unless overridden.
