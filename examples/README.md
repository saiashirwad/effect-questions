# Runnable workflows

Run from the repository root with Node 24 after `pnpm install`. Live workflows use
`TYPESAFE_API_KEY`. Configuration is in constants at the top of each file.

| Run                                    | What it does                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node examples/triage.ts`              | Asks a batch of typed questions about a support ticket in one request, then routes with `branch`. A minimum confidence turns an unsure routing into an `UncertainDecision` handled by the program.                                              |
| `node examples/investigation.ts`       | Investigates a vague complaint about a real website. The model picks the next probe (DNS, one fetch, repeated fetches, or "stop"), the program runs it, the findings rule hypotheses out, and the code decides once one explanation remains.    |
| `node examples/conversation.ts`        | Replays a support chat as a Stream. After each customer turn one request judges the stage and the customer's temperature; the program advances a state machine and fires transitions once, ending when the conversation resolves.               |
| `node examples/review.ts`              | Reviews the tracked working-tree diff against `HEAD` using plain-English acceptance criteria, ranks the changed files by how much they need a human, and runs the verification that fits the change. Change `base` to compare another revision. |
| `node examples/github-triage.ts`       | Fetches the latest 50 open GitHub issues, assesses the newest, chooses a maintainer workflow, ranks the others by relatedness, and checks the closest three for duplicates concurrently. Change `repository` to another public repository.      |
| `node examples/documentation-audit.ts` | Reads library source and checks six documented contracts against executable code, one evaluation per file.                                                                                                                                      |
| `node examples/evidence.ts`            | Runs offline aggregation, cost-based decisions, and a confidence gate without an API key.                                                                                                                                                       |

GitHub triage uses the public, unauthenticated API and is subject to its rate limits. Network
probes and command results in the investigation and review workflows are real; the
recommendations drawn from them are model judgments.
