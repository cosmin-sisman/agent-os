{{! area: docs }}
# TypeScript

Applies to {{paths}}.

- `strict` mode on; no `any` (use `unknown` and narrow). Types describe the data, not the implementation.
- Build file paths from `import.meta.url` with `fileURLToPath(new URL(…, import.meta.url))`, never `.pathname`: it breaks on Windows drive letters and folders with spaces.
- Never import from a test file: the test runner registers its tests again. Shared helpers go in `__fixtures__/` next to the code.
- Handle every promise: `await` it or return it; no floating promises.
{{#if lowAi}}
## Read the docs first

Agents know {{lowAi}} poorly: read its official documentation for the version in use before writing code, and cite it in the change request.
{{/if}}
