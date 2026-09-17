# Examples

Run from the repository root with Node 24 after `pnpm install`. Live examples read
`TYPESAFE_API_KEY`. Settings are constants at the top of each file.

| Run                                    | What happens                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node examples/triage.ts`              | One request asks two questions about a ticket. Then `branch` routes it. If the model is unsure, a person is asked.                                       |
| `node examples/investigation.ts`       | A vague complaint about a real site. The model picks a probe, or stop. The program runs it. Findings rule hypotheses out. Code decides once one is left. |
| `node examples/conversation.ts`        | A support chat replayed as a Stream. Each customer turn is judged once. A state machine advances and fires each transition once.                         |
| `node examples/search.ts`              | Fetches pages of open issues until the model spots what `wanted` describes, or the page budget runs out. Then it picks the match.                        |
| `node examples/draft.ts`               | Watches `README.md`. Every save is judged against four reader needs. Exits when all are met.                                                             |
| `node examples/review.ts`              | Judges the working-tree diff against plain-English requirements. Ranks changed files by how much they need a human. Runs the matching checks.            |
| `node examples/github-triage.ts`       | Assesses the newest open issue, picks a maintainer workflow, ranks related issues, and checks the closest three for duplicates.                          |
| `node examples/which.ts`               | Which Effect module do I need? Ranks all 138 installed modules by their own doc summaries, in one request. Change `need`.                                |
| `node examples/bisect.ts`              | `git bisect` where the test is a question about the file at each commit. Binary search, one request per step.                                            |
| `node examples/extraction.ts`          | Regex finds every amount and date in an email. The model picks the balance and the deadline. Answers are always substrings of the input.                 |
| `node examples/documentation-audit.ts` | Checks six documented claims against the source that should support them.                                                                                |
| `node examples/evidence.ts`            | Offline. Aggregation, expected loss, and a confidence gate. No API key needed.                                                                           |

GitHub examples use the public API and its rate limits. Probes and command results are real.
The conclusions drawn from them are model judgments.
