# Rules for agents working on this repository

These rules came from lessons triaged with `/retro` (#221). [AGENTS.md](../AGENTS.md) keeps only the conventions an agent needs on every task. The rules below apply when you touch the area they name. Each rule ends with the lesson it came from.

## Platform calls

- **Retry Projects v2 mutations.** GitHub Projects v2 answers bursts of item mutations with "temporary conflict, please try again". Every project mutation in the adapter retries with exponential backoff. A retry never creates a duplicate: adding an item that already exists returns that item. (lesson: project-conflicts)
- **Merge into existing settings, never replace them.** When you update a ruleset, branch protection or a label that already exists, keep every field you did not mean to change. Replacing it with the desired version drops what the platform or the owner added, such as `integration_id` or `allowed_merge_methods`. The dry run says what it keeps as well as what is new. (lesson: merge-not-replace-settings)

## Shell and exit codes

- **Never pipe a check into another command when its exit code decides what happens next.** `agent-os check title … | head -1 && git commit` commits even when the check fails, because the pipeline returns the status of `head`. Run the check on its own (or use `set -o pipefail`), look at the exit code, and only then trim the output. PR #163 went out with a 75-character title this way. (lesson: never-pipe-a-check-into)

## Configuration schema

- **Ownership is inherited.** When the schema marks a node as personal or team, every leaf under it takes its owner from the nearest marked ancestor, and an unmarked leaf has an explicit default. If you check the flag only where it is written, team keys slip into the personal file. Test each wrong-file case. (lesson: ownership-inherits)

## Paths

- **Build file paths with `fileURLToPath(new URL(…, import.meta.url))`, never with `.pathname`.** `.pathname` keeps a leading slash before Windows drive letters and URL-encodes spaces, so the path breaks on Windows and in folders with spaces. (lesson: file-url-paths)

## Tests

- **Never import from a `*.test.mjs` file.** node:test registers the imported file's tests again in the importer, so they run twice and their failures are reported twice. Shared test helpers go in `__fixtures__/` next to the code, which is left out of the package. (lesson: test-helpers)

## YAML

- **Quote identifiers.** A hex color made only of digits (`000000`, `123456`) is a number in YAML, not a string. The same goes for versions, ids and hashes. Quote every value that is an identifier rather than a quantity, and still coerce defensively in the code that reads it. (lesson: yaml-hex-colors)
