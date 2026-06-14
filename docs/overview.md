# desgraca-agents

`desgraca-agents` is a pi extension for supervising task-scoped worker agents from a dedicated TUI dashboard.

The extension is designed for controlled multi-agent coding work. Worker agents can read the current project, but their writable output is isolated under `.agents/{AGENT_NAME}`. Generated work is not applied automatically; the user must inspect and explicitly accept proposals before they are written back to the main project.

## Core concept

`desgraca-agents` supports a user-controlled manager/worker workflow:

1. **User as manager**: Creates narrow agent jobs, starts or aborts workers, reviews logs, sends follow-up messages, and decides what to accept.
2. **Agents as workers**: Run as isolated task-scoped subprocesses. They produce reviewable artifacts such as proposals and notes instead of directly editing the project.

## Key features

- **Dedicated dashboard**: `/agents` opens a full dashboard for creating, selecting, starting, clearing, deleting, and inspecting agent jobs.
- **Isolated workspaces**: Each job writes only under `.agents/{AGENT_NAME}`.
- **Proposal-based changes**: Code changes are created as proposals under `.agents/{AGENT_NAME}/proposals/{ORIGINAL_PATH}` and accepted only through an explicit artifact-viewer flow.
- **Agent notes**: Workers can create and revise notes under `.agents/{AGENT_NAME}/notes` for findings, plans, and handoff details.
- **Agent-scoped permissions**: `/agent-settings` and `/agent-policy-cycle <tool>` configure policies for worker-agent tools without intercepting normal parent-session tool calls.

## Commands

- `/agents`: Open the agent dashboard. Requires TUI mode.
- `/agent-settings`: Open agent-scoped permission settings.
- `/agent-policy-cycle <tool>`: Cycle one agent tool policy between `allow`, `ask`, and `deny`.
