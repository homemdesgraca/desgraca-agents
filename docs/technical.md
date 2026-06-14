# Technical Reference

## Agent-only tools

Worker agents do not receive the generic built-in `write` or `edit` tools from the subprocess runner. They use agent-only tools that write inside the isolated workspace.

### Proposal tools

#### `agent_write_proposal`

Creates or replaces a full-file proposal.

- **Input**: `originalPath`, `content`, optional `description`.
- **Output location**: `.agents/{AGENT_NAME}/proposals/{originalPath}`.
- **Behavior**: Writes the proposal file without modifying the original project file.

#### `agent_edit_proposal`

Creates a proposal by applying exact replacements to an existing project file in memory.

- **Input**: `originalPath`, `edits[]`, optional `description`.
- **Edit format**: Each edit has `oldText` and `newText`.
- **Behavior**: Reads the original project file, requires each `oldText` to match exactly once, applies replacements in memory, and writes the resulting proposal under the agent workspace.

### Note tools

#### `agent_create_note`

Creates or replaces a named note under `.agents/{AGENT_NAME}/notes`.

#### `agent_edit_note`

Applies exact text replacements to an existing note. Each `oldText` must match exactly once.

#### `agent_view_notes`

Lists notes when called without a note name, or reads a specific note when a name is provided.

### Inspection tool

#### `agent_view_artifacts`

Lists artifacts in the current agent workspace, or inspects a specific artifact. When inspecting a proposal, it returns a plain diff against the original project file when possible.

## Orchestrator tools

Orchestrator tools are only available inside orchestrator subprocesses. They enable planning, coordination, and worker draft creation without direct project mutation.

### `orchestrator_update_plan`

Replaces the active plan for the orchestrator session.

- **Input**: `{ content: string }`
- **Behavior**: Writes the content to the session's `plan.md` and appends a transcript entry.

### `orchestrator_create_agent_draft`

Creates or updates an ordered worker draft with minimal input.

- **Input**: `{ name: string, task: string, order: number }`
- **Behavior**: Creates a draft with the given name, task, and run order. If a linked `AgentJob` exists and is still a draft without user edits, it updates the job. Otherwise, it creates a new draft job. Drafts from the same orchestrator session with the same order are displayed as a parallel group in AGENTS mode; this grouping is derived from existing metadata and is not persisted as a separate model.

### `orchestrator_request_start_agent`

Requests the user to start drafted worker(s). Despite the legacy name, the preferred target is numeric order.

- **Input**: `{ order?: number, name?: string, waitForResponse?: boolean }`
- **Behavior**: With `order`, creates one pending request for every draft in the active session with that order. If only one worker has the order, the same flow starts just that worker. `name` remains supported for legacy single-agent starts. If `waitForResponse` is false, the tool returns immediately. If true, it polls until the request is denied or all started workers reach terminal status, then returns each started agent's final response individually.

### `orchestrator_list_agent_statuses`

Returns status summaries for all worker drafts and linked jobs in the active session.

- **Input**: `{}`
- **Output**: Ordered list of summaries including order, name, draft status, agent status, task summary, pending approvals, artifact count, and final response availability.

### `orchestrator_get_agent_details`

Returns detailed information about a specific worker.

- **Input**: `{ name: string, waitForResponse?: boolean }`
- **Behavior**: If `waitForResponse` is true, polls until the worker reaches terminal status. Returns task, order, status, recent logs, pending approvals, artifacts, and final response.

### `orchestrator_suggest_artifact_edit`

Creates a review-only suggestion attached to a worker artifact.

- **Input**: `{ agentName: string, artifactPath: string, content: string, summary?: string }`
- **Behavior**: Creates a suggestion file under `.agents/{AGENT_NAME}/artifact-suggestions/{path}.suggestion`. The user may fuse this suggestion into the artifact from ARTIFACTS mode, but this does not apply proposals to the main project.

### `orchestrator_create_note`

Creates or replaces a named note inside the orchestrator session notes directory.

- **Input**: `{ name: string, content: string }`

### `orchestrator_edit_note`

Edits an existing orchestrator note with exact text replacements.

- **Input**: `{ name: string, edits[] }`
- **Edit format**: Each edit has `oldText` and `newText`.

### `orchestrator_view_notes`

Lists or reads orchestrator session notes.

- **Input**: `{ note?: string }`
- **Behavior**: Without a note name, lists all notes. With a name, reads the specified note.

## Data models

### `AgentJob`

Important fields:

- `id`: Unique job identifier.
- `name`: Sanitized agent name used for display and workspace paths.
- `task`: User-provided worker instructions.
- `model`: Optional model selection for the worker subprocess.
- `status`: Current state: `draft`, `waiting`, `running`, `blocked`, `done`, `failed`, or `aborted`.
- `allowedTools`: Tool list for the worker. If empty, extension settings provide the runner tools.
- `readableRoot`: Main project root.
- `writableRoot`: Isolated agent workspace.
- `logs`: Detailed log entries.
- `tracking`: Higher-level dashboard events.
- `pendingApprovals`: Agent-scoped tool approvals and their resolution state.
- `artifacts`: Discovered files from the writable root.
- `finalResponse`: Last assistant final response from the worker.
- `process`: Subprocess metadata such as command, pid, exit code, and signal.
- `source`: Optional metadata indicating the job was created from an orchestrator draft. For orchestrator jobs, `source.sessionId + source.order` is also used to derive dashboard-only parallel groups.
- `userEditedAt`: Timestamp marking when the user edited the job from AGENTS mode.

### `AgentArtifact`

Important fields:

- `id`: Unique artifact identifier.
- `agentId`: Job id that owns the artifact.
- `path`: Artifact path relative to the main project root, usually under `.agents/{AGENT_NAME}`.
- `absolutePath`: Full artifact path on disk.
- `sizeBytes`: Artifact size.
- `updatedAt`: Modification timestamp.
- `kind`: `proposal`, `note`, or `artifact`.
- `originalPath`: Main-project path targeted by a proposal. Present only for proposal artifacts.
- `suggestions`: Array of orchestrator artifact suggestions attached to this artifact.

### `AgentApproval`

Represents a pending or resolved policy decision for an agent tool call.

- `toolName`: Tool being requested.
- `inputSummary`: Compact summary of the request input.
- `warnings`: Simple risk warnings, when applicable.
- `reason`: Why approval is required.
- `status`: `pending`, `approved`, or `denied`.

Proposal acceptance is not represented as an `AgentApproval`; it is handled by the artifact viewer's two-step accept flow.

### `OrchestratorSession`

- `id`: Unique session identifier.
- `title`: Human-readable session title.
- `cwd`: Project working directory.
- `status`: Session status: `idle`, `running`, `waiting_for_user`, `waiting_for_agent`, `failed`, `done`, or `aborted`.
- `model`: Selected model for the orchestrator subprocess.
- `activePlanPath`: Path to the active plan file.
- `createdAt`, `updatedAt`, `startedAt`, `finishedAt`: Timestamps.
- `process`: Subprocess metadata.
- `waitingFor`: Current wait state for start requests or agents.

### `OrchestratorTranscriptEntry`

- `id`: Entry identifier.
- `timestamp`: When the entry was created.
- `kind`: `user`, `assistant`, `tool`, `status`, or `error`.
- `title`: Entry title.
- `message`, `input`, `output`: Entry content.
- `toolName`: Tool name for tool events.

### `OrchestratorWorkerDraft`

- `id`: Draft identifier.
- `sessionId`: Parent session id.
- `name`: Worker name.
- `task`: Worker task description.
- `order`: Numeric run order.
- `status`: `draft`, `queued`, `started`, `done`, `failed`, `aborted`, or `discarded`.
- `agentJobId`: Linked agent job id, if any.
- `createdAt`, `updatedAt`: Timestamps.
- `warning`: Warning message if the linked job could not be updated.

### `OrchestratorStartRequest`

- `id`: Request identifier.
- `sessionId`: Parent session id.
- `kind`: Request target kind, either `agent` or `order` when present.
- `order`: Numeric worker order for order-based requests.
- `draftId`: First associated draft id for compatibility.
- `draftIds`: Associated draft ids for order/group requests.
- `agentJobId`: First linked agent job id for compatibility.
- `agentJobIds`: Linked agent job ids for order/group requests.
- `agentName`: Display label for the request.
- `agentNames`: Requested worker names for order/group requests.
- `waitForResponse`: Whether the orchestrator should wait for resolution.
- `status`: `pending`, `approved`, `denied`, `started`, `done`, `failed`, or `aborted`.
- `message`: User message for the request.
- `createdAt`, `resolvedAt`, `startedAt`, `finishedAt`: Timestamps.
- `resultSummary`: For completed start requests, final responses from each started worker separated by worker name.
- `denialReason`: Reason for denial, if denied.

## Settings schema

### `AgentExtensionSettings`

```typescript
interface AgentExtensionSettings {
  toolPolicies: Record<string, ToolPolicy>;
  childRunnerTools: string[];
  taskWorkspaceDir: string;
  agents: {
    defaultModel: "default" | AgentModelSelection;
  };
  orchestrator: {
    toolPolicies: Record<string, ToolPolicy>;
    runnerTools: string[];
  };
}
```

- `toolPolicies`: Per-tool policies for worker subprocesses. Worker shell access is controlled by the `bash` policy, but implemented through the isolated `agent_bash` tool to avoid ordinary pi bash approval extensions.
- `childRunnerTools`: Base worker subprocess tool list. Normalization includes `agent_bash` and agent-only tools while still excluding generic `bash`, `write`, and `edit`.
- `agents.defaultModel`: When set to `"default"`, orchestrator-created workers use the same model as their source orchestrator session. When set to a specific model, they use that model.
- `orchestrator.toolPolicies`: Per-tool policies for orchestrator subprocesses.
- `orchestrator.runnerTools`: List of tools allowed in orchestrator subprocesses.

Default orchestrator policies allow read/search tools, orchestrator control tools, notes tools, and deny `bash` by default.

## Parallel agent groups

Parallel groups are a derived dashboard view, not a persisted data model. The AGENTS tab groups orchestrator-linked jobs when they share the same `source.sessionId` and `source.order`. Jobs from different orchestrator sessions are not grouped together even if their numeric order matches.

The `U` group-start action builds an in-memory start plan for the selected job's group. Each member is rechecked before launch and skipped if it is already running, no longer a draft, has prior output, has artifacts, or has pending approvals. Confirming a group start calls the same per-agent runner used by `S`; it does not resolve approvals, apply artifacts, mark orchestrator start requests as started, or create extra group files.

Orchestrator order start requests use the same derived group logic, but they are tracked as `OrchestratorStartRequest` records. Approving or denying these requests uses a focused dashboard overlay. Order-based request completion stores each started worker's final response under the request result summary, separated by worker name.
