# desgraca-agents

`desgraca-agents` is a [pi](https://pi.dev/) extension for supervising isolated, task-scoped worker agents from a dedicated TUI dashboard.

It is built around user control. Workers can read the current project, but their output stays under their own `.agents/{AGENT_NAME}` workspace until you review and accept it.

## What it provides

- A full `/agents` dashboard for creating, starting, aborting, clearing, deleting, and inspecting agent jobs.
- An ORCHESTRATOR mode for persistent planning sessions that draft ordered workers and request user-approved starts.
- Isolated worker workspaces under `.agents/{AGENT_NAME}`.
- Proposal-based code changes that are reviewed before being applied.
- Agent notes for plans, findings, and handoff details.
- Agent-scoped permission settings that do not affect normal parent-session tool calls.

## Commands

- `/agents`: Open the agent dashboard. Requires TUI mode.
- `/agent-settings`: Open worker/orchestrator permission policy settings and default model settings.
- `/agent-policy-cycle <tool>`: Cycle one agent tool policy between `allow`, `ask`, and `deny`.

## Dashboard keys

### Modes

- `G`: AGENTS mode.
- `O`: ORCHESTRATOR mode.
- `T`: TRACKING mode.
- `P`: APPROVALS mode.
- `F`: ARTIFACTS mode.
- `H` or `?`: HELP mode.
- `Q` / `E`: Walk backward or forward through modes.
- `Esc` or `Ctrl-C`: Close the dashboard.

### Job management

In AGENTS mode:

- `C`: Create a job.
- `I`: Edit a draft job's name, task, and model.
- `S`: Start the selected job.
- `X`: Abort the selected running job.
- `K`: Clear selected-agent output after confirmation.
- `Delete` or `Backspace`: Delete the selected job after confirmation.
- `1`-`9`: Select an agent job.

### Orchestrator

In ORCHESTRATOR mode:

- `C`: Create an orchestrator session with a title, optional initial prompt, and model picker.
- `M`: Send a message to the active orchestrator session.
- `1`-`9`: Select an orchestrator session.
- `A` or `Enter`: Approve a pending orchestrator start request through confirmation.
- `N`: Deny a pending orchestrator start request through confirmation.

The orchestrator can create ordered worker drafts with only worker name, task, and order. Those drafts appear as normal draft jobs in AGENTS mode, where the user can edit model/task/name before starting.

### Tracking and approvals

- `M`: Send a follow-up message in TRACKING mode.
- `A`: Approve the first pending tool approval in APPROVALS mode.
- `N`: Deny the first pending tool approval in APPROVALS mode.
- `Up` / `Down`: Scroll the right-hand panel when needed.

### Artifacts

In ARTIFACTS mode:

- `[` / `]`: Move between visible artifacts and notes.
- `Enter`: Open the selected artifact.
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

Permission policies are scoped to worker and orchestrator subprocesses only. This extension does not intercept normal tool calls in the parent pi session.

Default worker behavior:

- Read and search tools are allowed for workers.
- Agent-only proposal, artifact, and note tools are allowed.
- Worker bash access is provided through the isolated `agent_bash` tool when the worker `bash` policy is `allow` or `ask`; it defaults to `ask`.
- In `ask` mode, `agent_bash` waits for approval from the `/agents` dashboard instead of relying on ordinary pi bash approval extensions.
- Setting worker `bash` to `deny` removes `agent_bash` from worker subprocess tool access.
- Generic built-in `bash`, `write`, and `edit` are not exposed to worker agents.

Default orchestrator behavior:

- Read/search, notes, plan updates, draft creation, status/detail tools, and start-request tools are allowed.
- `bash` defaults to `deny`.
- Generic `write`/`edit`, worker proposal tools, and artifact acceptance are unavailable.
- Agent starts requested by the orchestrator require explicit user confirmation.

Simple warnings are shown for risky bash patterns such as `rm`, `curl`, `wget`, `sudo`, `chmod`, `chown`, `kill`, and shell redirection.

## Typical usage

1. Open `/agents`.
2. Create a focused job with `C`.
3. Start the selected worker with `S`.
4. Watch progress in TRACKING mode.
5. Review proposals and notes in ARTIFACTS mode.
6. Open a proposal, inspect the diff, and press `A` twice if you want to apply it.
7. Send follow-up instructions with `M` when more work is needed.

## More documentation

- [Overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Usage guide](docs/usage.md)
- [Technical reference](docs/technical.md)
