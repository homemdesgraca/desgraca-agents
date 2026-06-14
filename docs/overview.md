# desgraca-agents

`desgraca-agents` is a pi extension for supervising task-scoped worker agents from a dedicated TUI dashboard.

The extension is designed for controlled multi-agent coding work. Worker agents can read the current project, but their writable output is isolated under `.agents/{AGENT_NAME}`. Generated work is not applied automatically; the user must inspect and explicitly accept proposals before they are written back to the main project.

## Core concept

`desgraca-agents` supports a user-controlled manager/worker workflow:

1. **User as manager**: Creates jobs, starts or aborts workers, reviews logs, resolves approvals, inspects artifacts, and decides what to accept.
2. **Orchestrator as planner**: Runs as a separate planning/control session that can discuss a larger goal, keep a plan, draft ordered workers, check worker status, and request user-approved starts.
3. **Agents as workers**: Run as isolated task-scoped subprocesses. They produce reviewable artifacts such as proposals and notes instead of directly editing the project.

The orchestrator is not a project owner. It cannot directly edit project files, approve worker tool calls, apply artifacts, or start workers without user confirmation.

## Key features

- **Dedicated dashboard**: `/agents` opens a full dashboard for AGENTS, ORCHESTRATOR, TRACKING, APPROVALS, ARTIFACTS, and HELP modes.
- **Persistent orchestrator sessions**: ORCHESTRATOR mode stores sessions, conversation threads, transcripts, plans, worker drafts, notes, and start requests under `.agents/_orchestrator`.
- **Ordered worker drafts**: The orchestrator can create worker drafts with only `name`, `task`, and `order`. Drafts appear as normal editable jobs in AGENTS mode.
- **User-mediated starts**: Orchestrator start requests require explicit dashboard approval. Denied requests do not start workers.
- **Isolated workspaces**: Each worker writes only under `.agents/{AGENT_NAME}`.
- **Proposal-based changes**: Code changes are created as proposals under `.agents/{AGENT_NAME}/proposals/{ORIGINAL_PATH}` and accepted only through an explicit artifact-viewer flow.
- **Artifact suggestions**: The orchestrator can attach review-only replacement suggestions to worker artifacts. The user may fuse a suggestion into the worker artifact, but this still does not apply proposals to the main project.
- **Agent notes and handoffs**: Workers can create notes under `.agents/{AGENT_NAME}/notes`. Later orchestrator-started workers may receive an `orchestrator-handoff.md` note summarizing earlier completed workers.
- **Scoped permissions**: Worker and orchestrator subprocess policies are configured separately and do not intercept normal parent-session tool calls.

## Commands

- `/agents`: Open the agent dashboard. Requires TUI mode.
- `/agent-settings`: Open worker/orchestrator permission settings and the default model setting for orchestrator-created workers.
- `/agent-policy-cycle <tool>`: Cycle one worker-agent tool policy between `allow`, `ask`, and `deny`.

## Safety model

The extension favors visible, interruptible work:

- workers do not write directly to the main project tree,
- orchestrators do not receive project mutation tools,
- worker proposal acceptance is a separate two-step artifact-viewer action,
- tool approvals and proposal acceptance are separate concepts,
- ordinary parent pi tool calls remain unaffected by worker/orchestrator policies.
