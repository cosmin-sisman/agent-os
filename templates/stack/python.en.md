{{! area: docs }}
# Python

Applies to {{paths}}.

- Type hints on public functions; run the type checker the project uses.
- Paths with `pathlib.Path`; no string concatenation for paths.
- Specific exceptions, never a bare `except:`; context managers for files and connections.
- No mutable default arguments.
{{#if lowAi}}
## Read the docs first

Agents know {{lowAi}} poorly: read its official documentation for the version in use before writing code, and cite it in the change request.
{{/if}}
