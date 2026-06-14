# desgraca-agents

`desgraca-agents` is a pi extension for supervising isolated, task-scoped worker agents from a dedicated TUI dashboard.

It is built around user control. Workers can read the current project, but their output stays under their own `.agents/{AGENT_NAME}` workspace until you review and accept it.

## What it provides

- A full `/agents` dashboard for creating, starting, aborting, clearing, deleting, and inspecting agent jobs.
- Isolated worker workspaces under `.agents/{AGENT_NAME}`.
- Proposal-based code changes that are reviewed before being applied.
- Agent notes for plans, findings, and handoff details.
- Agent-scoped permission settings that do not affect normal parent-session tool calls.

## Commands

- `/agents`: Open the agent dashboard. Requires TUI mode.
- `/agent-settings`: Open agent-scoped permission policy settings.
- `/agent-policy-cycle <tool>`: Cycle one agent tool policy between `allow`, `ask`, and `deny`.

## Dashboard keys

### Modes

- `G`: AGENTS mode.
- `T`: TRACKING mode.
- `P`: APPROVALS mode.
- `F`: ARTIFACTS mode.
- `H` or `?`: HELP mode.
- `Q` / `E`: Walk backward or forward through modes.
- `Esc` or `Ctrl-C`: Close the dashboard.

### Job management

In AGENTS mode:

- `C`: Create a job.
- `S`: Start the selected job.
- `X`: Abort the selected running job.
- `K`: Clear selected-agent output after confirmation.
- `Delete` or `Backspace`: Delete the selected job after confirmation.
- `1`-`9`: Select an agent job.

### Tracking and approvals

- `M`: Send a follow-up message in TRACKING mode.
- `A`: Approve the first pending tool approval in APPROVALS mode.
- `N`: Deny the first pending tool approval in APPROVALS mode.
- `Up` / `Down`: Scroll the right-hand panel when needed.

### Artifacts

In ARTIFACTS mode:

- `[` / `]`: Move between visible artifacts and notes.
- `O` or `Enter`: Open the selected artifact.
- `V`: Hide or show note artifacts.
- `R`: Refresh artifact discovery.

In the artifact viewer:

- `D`: Show a diff for proposal artifacts.
- `P`: Show proposal or raw artifact content.
- `O`: Show the original file for proposal artifacts.
- `A`: Start proposal acceptance. Press `A` again to confirm.
- `W`: Toggle wrapping.
- `PageUp` / `PageDown`: Jump between changed lines in diff view, or page through raw content.
- `Q` or `Esc`: Close the viewer.

## Workspace rule

Each job may read from the current pi working directory. Writable output and persisted dashboard state are stored under:

```text
.agents/{AGENT_NAME}
```

Common workspace paths:

- `agent-job.json`: Persisted job metadata, logs, approvals, artifacts, selected model, and final response.
- `proposals/{ORIGINAL_PATH}`: Reviewable project-file proposals.
- `notes/{NAME}.md`: Agent notes created by note tools.

Generated work is not applied automatically. A proposal is written back to the project only after you accept it from the artifact viewer.

## Permissions

Permission policies are agent-scoped only. This extension does not intercept normal tool calls in the parent pi session.

Default behavior:

- Read and search tools are allowed for workers.
- Agent-only proposal, artifact, and note tools are allowed.
- `bash` defaults to `ask`.
- Generic built-in `write` and `edit` are not exposed to worker agents.

Simple warnings are shown for risky bash patterns such as `rm`, `curl`, `wget`, `sudo`, `chmod`, `chown`, `kill`, and shell redirection.

## Typical usage

1. Open `/agents`.
2. Create a focused job with `C`.
3. Start the selected worker with `S`.
4. Watch progress in TRACKING mode.
5. Review proposals and notes in ARTIFACTS mode.
6. Open a proposal, inspect the diff, and press `A` twice if you want to apply it.
7. Send follow-up instructions with `M` when more work is needed.

## TODO

Future features to implement:

- Optional main orchestrator that can suggest or create separated jobs automatically, while still requiring user approval before workers run.

## More documentation

- [Overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Usage guide](docs/usage.md)
- [Technical reference](docs/technical.md)
