# desgraca-agents

This project is a pi extension focused on controlled multi-agent work inside pi. Its core purpose is to provide a separate agent-control screen where the user can create, supervise, approve, deny, inspect, and coordinate multiple isolated agent jobs.

## Core concept

The extension should feel like a dedicated pi screen rather than a small helper command. The screen is a dashboard populated by agent jobs. Each agent job is created for a narrow task, such as implementing a module, researching a subsystem, or producing an isolated patch proposal.

The user is always in control. Agents may suggest delegations, request actions, produce artifacts, or propose changes, but the user decides what runs, what is approved, what is denied, and what gets applied to the real project.

## Main directory and isolation model

The project boundary is the current pi working directory at runtime (`ctx.cwd`). This is the main directory for the dashboard session.

Agent jobs may read from the main directory, subject to the configured permissions. Agent jobs must not directly write into the main project tree. Their writable area is restricted to:

```text
{ctx.cwd}/.agents/{AGENT_NAME}
```

This keeps each worker's output isolated and reviewable. Applying any generated work back into the main project should be an explicit user-controlled action.

## Permission philosophy

The extension should prioritize asking the user before actions. This is especially important for powerful tools such as `bash`, `write`, and `edit`.

Permissions should be configurable through extension settings for agent jobs only. Users should be able to toggle which agent tools require approval and which agent tools can run automatically. This extension must not intercept normal plain-LLM tool calls in the parent pi session; those belong to the user's regular approval setup. A safe default for agents is to allow simple read/search operations while asking for bash and file mutations.

Risk warnings should stay simple and understandable. Do not build an overly complex classifier. Basic warnings such as `Warning: rm detected` or `Warning: curl detected` are enough when command text contains risky patterns.

## Agent model

Agents are not primarily fixed specialists. They are task-scoped workers with names derived from their assigned job, for example `module-x-implementer` or `api-cleanup-worker`.

The extension may include a main callable/orchestrating agent or tools that help suggest delegations, but suggested delegations should still be approved by the user before execution.

Each agent job should track at least:

- name
- task
- status
- allowed tools or permission profile
- readable root
- writable root
- recent events/logs
- pending approvals
- produced files/artifacts

## Dashboard interaction

The primary UI should be a full dashboard launched from pi, for example via a command such as `/agents`. The dashboard should show agent jobs, selected-agent details, logs, approvals, and produced artifacts/diffs.

Keyboard control should be direct and modal where useful. Do not assume the user prefers `j/k` navigation. Prefer clear direct keys and mode keys, such as pressing `D` for diff mode and then a number to inspect a specific agent's diffs. Exact keybindings can evolve, but the interface should remain fast, explicit, and user-controlled.

## Implementation principles

Prefer pi's native extension and TUI APIs before adding dependencies. The MVP should be possible with:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- Node.js built-ins such as `child_process`, `fs`, `path`, and `crypto`

Avoid extra packages unless the built-in APIs become clearly insufficient.

Agent execution may use isolated pi subprocesses or pi SDK sessions. Subprocesses are a good fit for isolated context windows and JSON event streaming. Any child process must preserve the same user-control and permission principles as the parent dashboard. Agent subprocesses should be explicitly marked as agent contexts, and approval logic should only activate for those marked agent contexts.

## Safety and trust

This extension is designed for attentive, interactive AI-assisted coding. It should make agent activity visible and interruptible, not invisible or autonomous. Dangerous or ambiguous actions should be surfaced to the user with enough context to approve or deny them confidently.

The extension should avoid hidden side effects, unexpected writes outside agent workspaces, and automatic application of generated changes to the main project.
