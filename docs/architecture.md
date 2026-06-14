# Architecture

## Isolation model

The project boundary is the current pi working directory at runtime (`ctx.cwd`). Agent jobs use two roots:

- **Readable root**: The main project directory. Workers may read and search this tree, subject to agent-scoped permissions.
- **Writable root**: A per-agent workspace at `.agents/{AGENT_NAME}`. Agent names are sanitized before being used as directory names.

Workers must not directly write to the main project tree. Project changes are represented as proposal files inside the writable root and are applied only when the user accepts them from the artifact viewer.

Each workspace also contains `agent-job.json`, which persists job metadata, logs, tracking entries, approvals, artifacts, selected model, and final response.

## Orchestrator isolation model

The orchestrator operates in a dedicated isolation model to separate high-level planning from low-level agent execution:

- **Workspace**: Orchestrator sessions and their associated data are stored in `.agents/_orchestrator/`.
- **Session Isolation**: Each session has its own directory for its `plan.md`, `transcript.jsonl`, `drafts.json`, `start-requests.json`, and `notes/`.
- **Tool Isolation**: Orchestrators are restricted to a specific set of orchestration tools. They cannot directly mutate project files, approve worker tool calls, or apply artifacts.
- **Persistence**: Session data is persisted atomically to disk, ensuring that state (like the current plan or drafted workers) survives between turns and subprocess runs.

## Agent execution

Workers run as isolated pi subprocesses in JSON mode. The dashboard starts subprocesses with the project root as the current working directory and passes agent context through environment variables, including the job id, agent name, writable root, and current settings.

Each worker turn is started with `--no-session`. Follow-up messages include the previous final response and the new user message, so the worker can continue from the dashboard state without directly sharing the parent pi session.

The runner streams JSON events from stdout and records:

- final assistant responses,
- tool events,
- errors,
- process metadata,
- tracking entries for the dashboard.

## Artifact management

Agent output is discovered by walking the writable root. Files are classified by location:

- `proposals/{ORIGINAL_PATH}`: Proposal artifacts that target files in the main project.
- `notes/{NAME}.md` or `notes/{NAME}.txt`: Note artifacts managed by the note tools.
- Other files: General review-only artifacts.

Only proposal artifacts with an `originalPath` can be accepted into the project. Acceptance verifies that the target remains inside the main project and outside `.agents`, then writes the proposal content to the target path.

## Permission system

Permissions are agent-scoped only. The extension does not intercept normal tool calls in the parent pi session.

Default worker policies allow read/search tools and the agent-only proposal, artifact, and note tools. Worker bash access is implemented as the isolated `agent_bash` tool, controlled by the worker `bash` policy. When the policy is `allow` or `ask`, workers receive `agent_bash`; in `ask` mode the tool waits for approval through the `/agents` dashboard. When the policy is `deny`, `agent_bash` is removed from worker tool access. Generic built-in `bash`, `write`, and `edit` are not exposed to worker agents by the subprocess runner.

The permission system also enforces simple scope rules:

- read/search tools stay inside the main project root,
- write/edit tools, if ever exposed by configuration, are constrained to the worker writable root,
- proposal tools target main-project paths but write only isolated proposal files.

Risk warnings are intentionally simple and pattern-based for sensitive bash commands such as `rm`, `curl`, `wget`, `sudo`, `chmod`, `chown`, `kill`, and shell redirection.
