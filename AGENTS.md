# desgraca-agents

This project is a pi extension for controlled multi-agent work inside pi. Its core purpose is to provide a dedicated agent-control dashboard where the user can create, supervise, approve, deny, inspect, and coordinate isolated task-scoped worker jobs.

The extension must remain user-controlled. Agents may produce proposals, notes, artifacts, logs, and tool approval requests, but the user decides what runs, what is approved, what is denied, and what gets applied to the real project.

## Core concept

The extension should feel like a dedicated pi screen rather than a small helper command. The primary interface is the `/agents` dashboard, which is populated by agent jobs.

Each agent job should be narrow and task-scoped, such as:

- implementing a module,
- researching a subsystem,
- preparing a refactor proposal,
- producing reviewable notes or artifacts.

Agents are workers, not autonomous owners of the project. The user remains the manager and final decision-maker.

## Main directory and isolation model

The project boundary is the current pi working directory at runtime (`ctx.cwd`). This is the main directory for the dashboard session and the readable root for worker agents.

Agent jobs may read and search the main directory, subject to configured agent-scoped permissions. Agent jobs must not directly write into the main project tree.

Each worker's writable area is restricted to:

```text
{ctx.cwd}/.agents/{AGENT_NAME}
```

Agent names are sanitized before they are used as workspace directory names.

Each workspace may contain:

- `agent-job.json` for persisted job state,
- `proposals/{ORIGINAL_PATH}` for project-file proposals,
- `notes/{NAME}.md` or `notes/{NAME}.txt` for worker notes,
- other review-only artifacts.

Generated work is not applied automatically. Applying a proposal back into the main project must be an explicit user-controlled action from the artifact viewer.

## Permission philosophy

Permissions apply to agent jobs only. This extension must not intercept normal plain-LLM tool calls in the parent pi session. Those belong to the user's regular pi configuration or approval extensions.

Agent permissions should be configurable through extension settings. Users should be able to toggle agent tool policies between `allow`, `ask`, and `deny`.

Safe defaults:

- allow simple read and search tools,
- allow agent-only proposal, artifact, and note tools,
- ask for `bash`,
- do not expose generic built-in `write` and `edit` to worker agents.

If generic file mutation tools are ever exposed by configuration, scope guards must restrict them to the worker writable root.

Risk warnings should stay simple and understandable. Do not build an overly complex classifier. Basic warnings such as `Warning: rm detected` or `Warning: curl detected` are enough when command text contains risky patterns.

## Agent model

Agents are task-scoped workers. They are not primarily fixed specialists. Their names should be derived from their assigned job, for example `module-x-implementer` or `api-cleanup-worker`.

Each agent job should track at least:

- name,
- task,
- status,
- selected model when applicable,
- allowed tools or permission profile,
- readable root,
- writable root,
- recent logs,
- tracking events,
- pending approvals,
- produced artifacts,
- final response,
- process metadata when running.

Agents may be started, aborted, cleared, deleted, inspected, and sent follow-up messages from the dashboard.

## Parallel agent groups

Orchestrator-created agents with the same numeric execution `order` are displayed as a parallel group in AGENTS mode. These agents are intended to run at the same time.

- Agents are grouped by both orchestrator session and order: same `source.kind === "orchestrator"`, same `source.sessionId`, and same `source.order`.
- Agents from different orchestrator sessions are never grouped together.
- The AGENTS tab visually groups same-order orchestrator jobs together.
- Press `U` in AGENTS mode to start the selected agent's parallel group after a focused confirmation overlay.
- The confirmation overlay lists runnable agents and skipped agents with reasons.
- If the group has 4 or more members, a large-group warning appears before starting.
- Confirming starts all currently runnable members and skips non-runnable members.
- Individual `S` start still works as before for single agents.

## Orchestrator model

Orchestrators are planning sessions that coordinate multiple worker agents. They cannot directly edit project files, approve tool calls, or apply artifacts.

Each orchestrator session tracks:

- title,
- status,
- selected model,
- allowed tools or permission profile,
- readable root,
- writable root for session data,
- recent logs,
- tracking events,
- pending start requests,
- produced artifacts,
- final response,
- process metadata when running.

Orchestrators may be started, aborted, cleared, deleted, inspected, and sent follow-up messages from the dashboard.

Orchestrators can create ordered worker drafts with only `name`, `task`, and `order`. Workers with the same order are intended to be parallelizable. When an orchestrator requests to start a worker order:

- If exactly one worker has that order, that worker starts.
- If multiple workers share the order, they are started together as a group.
- The request appears as a prominent `ACTION REQUIRED` callout in ORCHESTRATOR mode.
- Approving or denying the request uses a focused dashboard overlay.
- The orchestrator may also request a specific worker by `name` for legacy compatibility.

## Proposal and artifact model

Workers must not edit project files directly. When a worker needs to suggest a project change, it should create a proposal through agent-only proposal tools.

Current agent-only tools include:

- `agent_write_proposal`,
- `agent_edit_proposal`,
- `agent_view_artifacts`,
- `agent_create_note`,
- `agent_edit_note`,
- `agent_view_notes`.

Proposal artifacts live under `.agents/{AGENT_NAME}/proposals/{ORIGINAL_PATH}` and mirror the original project path. Notes live under `.agents/{AGENT_NAME}/notes`.

Only proposal artifacts with an original project path can be accepted into the main project. Acceptance must validate that the target is inside the main project and outside `.agents`.

Tool approvals and proposal acceptance are separate concepts:

- approvals resolve policy-controlled tool calls,
- proposal acceptance writes a reviewed proposal into the project through the artifact viewer.

## Dashboard interaction

The primary UI is a full dashboard launched with `/agents` in TUI mode. The dashboard should show agent jobs, selected-agent details, tracking, approvals, artifacts, and help.

Keyboard control should be direct and modal where useful. Do not assume the user prefers `j/k` navigation.

Current dashboard mode keys:

- `G` for AGENTS,
- `O` for ORCHESTRATOR,
- `T` for TRACKING,
- `P` for APPROVALS,
- `F` for ARTIFACTS,
- `H` or `?` for HELP,
- `Q` and `E` to walk modes,
- `Esc` or `Ctrl-C` to close.

ARTIFACTS mode opens a large artifact viewer. Diff viewing, proposal viewing, original-file viewing, wrapping, and two-step proposal acceptance belong to that viewer.

The interface should remain fast, explicit, and user-controlled.

Do not use generic inline `Y/N` confirmation prompts for dashboard actions. Use focused dashboard dialog screens or overlay components for confirmations, especially destructive or state-changing actions such as clear, delete, accept, approve, deny, and start.

## Implementation principles

Prefer pi's native extension and TUI APIs before adding dependencies. The project should remain possible with:

- `@earendil-works/pi-coding-agent`,
- `@earendil-works/pi-tui`,
- Node.js built-ins such as `child_process`, `fs`, `path`, and `crypto`.

Avoid extra packages unless the built-in APIs become clearly insufficient.

Agent execution may use isolated pi subprocesses or pi SDK sessions. The current implementation uses isolated subprocesses because they fit separate context windows and JSON event streaming.

Any child process must preserve the same user-control and permission principles as the parent dashboard. Agent subprocesses should be explicitly marked as agent contexts, and approval logic should only activate for those marked agent contexts.

## Safety and trust

This extension is designed for attentive, interactive AI-assisted coding. It should make agent activity visible and interruptible, not invisible or autonomous.

Dangerous or ambiguous actions should be surfaced to the user with enough context to approve or deny them confidently.

The extension should avoid:

- hidden side effects,
- unexpected writes outside agent workspaces,
- automatic application of generated changes to the main project,
- intercepting unrelated parent-session tool calls.
