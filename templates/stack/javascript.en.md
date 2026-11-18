{{! area: docs }}
# JavaScript

Applies to {{paths}}.

- Modern ES modules; `const` by default, no `var`. Prefer built-ins over a new dependency.
- Build file paths from `import.meta.url` with `fileURLToPath(new URL(…, import.meta.url))`, never `.pathname`.
- Never import from a test file; shared test helpers go in `__fixtures__/`.
- Handle every promise: `await` it or return it.
{{#if lowAi}}
## Read the docs first

Agents know {{lowAi}} poorly: read its official documentation for the version in use before writing code, and cite it in the change request.
{{/if}}
