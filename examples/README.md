# Runnable workflows

Run from the repository root with Node 24 after `pnpm install`. Live workflows use
`TYPESAFE_API_KEY`. Configuration is in constants at the top of each file.

| Run                                    | Input and behavior                                                                                                                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node examples/change-checks.ts`       | Reads the tracked Git diff against `HEAD~1`, assesses compatibility concerns, then executes formatting alone or static checks and compilation. Change `base` to compare another revision. Untracked files are not included.                                             |
| `node examples/documentation-audit.ts` | Reads actual library source and checks six documented contracts against executable code. Prints a per-claim report; each file's questions share one evaluation.                                                                                                         |
| `node examples/github-triage.ts`       | Fetches the latest 50 open GitHub issues/PRs, filters out PRs, assesses the newest issue, chooses a maintainer workflow, and compares it with up to 12 other issues for a possible duplicate. Prints recommendations. Change `repository` to another public repository. |
| `node examples/flow.ts`                | Walks through a fixed support ticket: prioritize, select a diagnostic, inspect a saved observation, then choose a recommendation.                                                                                                                                       |
| `node examples/main.ts`                | Runs the detailed ticket workflow with confidence gating and expected-loss decisions.                                                                                                                                                                                   |
| `node examples/evidence.ts`            | Runs offline aggregation and cost-based decisions without an API key.                                                                                                                                                                                                   |

GitHub triage uses the public, unauthenticated API and is subject to its rate limits.
Its duplicate search covers only the fetched candidates. Documentation findings and
issue recommendations are model judgments; the check-selection workflow reports actual
command failures through Effect's error channel.
