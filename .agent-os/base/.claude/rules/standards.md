# Coding standards

These apply to every change, whatever language the chat is in. Language-specific rules live in `.claude/rules/stack/` and load for their paths.

## Always

- **English in code**: identifiers, comments, docstrings, log messages and commit messages.
- **Every file opens with a 1–3 line header**: what it is and where it fits. Public functions and types document their contract; comments explain *why*, not *what*.
- **Small, single-purpose functions**, names from the domain, consistent error handling. No dead code, no duplicated logic, no `TODO` without an issue reference (`TODO(#123)`).
- **The simplest correct solution.** Optimize what is measured or obviously hot (I/O in loops, N+1 queries, unbounded memory). Never trade clarity for speed without a reason written next to the code.
- **Tests come with the change**: the issue's scenarios become tests in the same pull request. A bug fix starts with the test that fails without it.

## Choosing between solutions

When there are several reasonable ways to do something:
1. name two or three candidates, one line each;
2. compare them on correctness, simplicity, fit with the existing code and stack, performance where it matters, testability and cost of change;
3. pick one and say why in one sentence. A non-trivial or hard-to-reverse choice goes into a decision record (`agent-os decision new`) or the journal;
4. implement only the chosen one, never two half-solutions.

## Data and configuration

- **Quote identifiers in YAML and other loosely typed formats**: colors (`"000000"`), versions (`"1.10"`), ids and zip codes are strings. Unquoted they become numbers. Code that reads them still coerces defensively.
- **Text files are LF.** Anything that records content hashes breaks on checkouts that convert line endings.
