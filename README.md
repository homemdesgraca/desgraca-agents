# desgraca-agents

`desgraca-agents` is a pi extension for supervising task-scoped agent jobs from a dedicated, themed TUI dashboard.

## Commands

- `/agents` opens the agent dashboard in TUI mode.
- `/agent-settings` opens agent-scoped permission policy settings.
- `/agent-policy-cycle <tool>` cycles one agent-scoped tool policy between `allow`, `ask`, and `deny`.

## Dashboard UI and keys

The `/agents` screen uses a tall bordered, theme-aware dashboard with an agent list pane, agent description pane, mode tabs, and wrapped footer hints. Press `H` for descriptive help that explains what each dashboard mode shows.

- `C` create a new job with empty name/task fields and a selectable worker model; `Esc` or `Ctrl+C` cancels and returns to the dashboard.
- `1`-`9` select an agent job.
- `Up` / `Down` scroll the right-hand panel when there is more content than visible space.
- `S` start the selected job.
- `X` abort the selected job.
- `Delete` or `Backspace` delete the selected job and its `.agents/{AGENT_NAME}` workspace after confirmation.
- `A` approve the first pending approval.
- `N` deny the first pending approval.
- `Enter` return to the main `AGENTS` screen.
- `L` show wrapped logs, including the full child subprocess launch command and final response output.
- `P` show approvals.
- `D` show artifacts; in artifact mode, `1`-`9` previews an artifact.
- `R` refresh artifacts.
- `H` show help.
- `Q` or `Esc` close the dashboard.

## Workspace rule

Each job may read from the current pi working directory. Job-owned writable output and persisted dashboard state belong under:

```text
.agents/{AGENT_NAME}
```

Each workspace includes `agent-job.json`, which persists the job metadata, logs, approvals, artifacts, selected model, and final response so jobs survive reopening `/agents` or starting a new pi session. The MVP runner starts child pi processes in read-only mode (`read`, `grep`, `find`, and `ls`) until full child tool-call approval is implemented. Generated work is not applied automatically to the main project.

## Permission defaults

These permission policies are agent-scoped only. `desgraca-agents` does not intercept or approve normal plain-LLM tool calls in the parent pi session; those should remain owned by your regular approval extensions or pi configuration.

For marked agent subprocesses, read/search tools are allowed by default. `bash`, `write`, and `edit` ask for approval by default if they are ever enabled for an agent. Simple bash warnings are surfaced for patterns such as `rm`, `curl`, `wget`, `sudo`, `chmod`, `chown`, `kill`, and shell redirection.
