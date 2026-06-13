# desgraca-agents

`desgraca-agents` is a pi extension for supervising task-scoped agent jobs from a dedicated, themed TUI dashboard.

## Commands

- `/agents` opens the agent dashboard in TUI mode.
- `/agent-settings` opens agent-scoped permission policy settings.
- `/agent-policy-cycle <tool>` cycles one agent-scoped tool policy between `allow`, `ask`, and `deny`.

## Dashboard UI and keys

The `/agents` screen uses a tall bordered, theme-aware dashboard with an agent list pane, agent description pane, mode tabs, and wrapped footer hints. Press `H` for descriptive help that explains what each dashboard mode shows.

- `G` show AGENTS mode, `T` show TRACKING, `P` show APPROVALS, `F` show ARTIFACTS, and `H` show HELP. `Q` and `E` walk backward/forward through those modes.
- `1`-`9` select an agent job in every dashboard mode.
- `Up` / `Down` scroll the right-hand panel when there is more content than visible space.
- AGENTS mode: `C` creates a new job, `S` starts it, `X` aborts it, `K` clears selected-agent output after confirmation, and `Delete` or `Backspace` deletes it after confirmation. Starting an already-started agent suggests clearing it first.
- TRACKING mode: `M` sends a follow-up message to the selected agent, including after it is `FINISHED`.
- APPROVALS mode: `A` approves and `N` denies the first pending approval.
- ARTIFACTS mode: `[` and `]` move between artifacts, `O` or `Enter` opens a large artifact viewer, and `R` refreshes artifact discovery.
- Artifact viewer: `Up` / `Down` scroll, `A` starts a two-step accept flow for proposal artifacts, `D` shows diff for proposal artifacts, `P` shows the proposal/raw artifact, `O` shows the original file for proposal artifacts, `W` toggles wrapping, and `Q` or `Esc` closes the viewer. The viewer shows both the artifact path and the final path that will be created or changed when accepted.
- `Esc` closes the dashboard.

## Workspace rule

Each job may read from the current pi working directory. Job-owned writable output and persisted dashboard state belong under:

```text
.agents/{AGENT_NAME}
```

Each workspace includes `agent-job.json`, which persists the job metadata, logs, approvals, artifacts, selected model, and final response so jobs survive reopening `/agents` or starting a new pi session. Worker agents may read/search the main project and may write reviewable artifacts under their own `.agents/{AGENT_NAME}` workspace only. Project-file change proposals are written under `.agents/{AGENT_NAME}/proposals/{ORIGINAL_PATH}`, mirroring the original project structure. Generated work is not applied automatically; accepting a proposal from the artifact viewer requires an explicit two-step user action.

## Permission defaults

These permission policies are agent-scoped only. `desgraca-agents` does not intercept or approve normal plain-LLM tool calls in the parent pi session; those should remain owned by your regular approval extensions or pi configuration.

For marked agent subprocesses, read/search tools are allowed by default. The agent-only `agent_write_proposal` and `agent_edit_proposal` tools are allowed by default after scope validation because they only write isolated proposals under the worker workspace. These agent-only tools are registered only inside marked agent subprocesses, so ordinary parent pi conversations cannot see or call them. Generic `write`, `edit`, and `bash` remain policy-controlled sensitive tools. Simple bash warnings are surfaced for patterns such as `rm`, `curl`, `wget`, `sudo`, `chmod`, `chown`, `kill`, and shell redirection.
