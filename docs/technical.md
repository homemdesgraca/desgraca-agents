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

### `AgentApproval`

Represents a pending or resolved policy decision for an agent tool call.

- `toolName`: Tool being requested.
- `inputSummary`: Compact summary of the request input.
- `warnings`: Simple risk warnings, when applicable.
- `reason`: Why approval is required.
- `status`: `pending`, `approved`, or `denied`.

Proposal acceptance is not represented as an `AgentApproval`; it is handled by the artifact viewer's two-step accept flow.
