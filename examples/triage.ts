import { Effect, Match, Schema } from "effect";
import { Decision, Jev, Question } from "../src/index.ts";

const Department = Schema.Literals(["billing", "technical", "account"]);
const Runbook = Schema.Literals(["service-status", "credentials", "integration"]);

export const Ticket = Schema.Struct({
  id: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
});
export type Ticket = typeof Ticket.Type;

export const triageQuestions = {
  department: Question.choice(Department, {
    instructions: "Which team owns the customer's main problem?",
    criteria: {
      billing: "Invoices, subscription prices, refunds, duplicate charges",
      technical: "API errors, integrations, outages, broken deployments",
      account: "Account profile, membership, sign-in to the dashboard",
    },
  }),
  impact: Question.score({
    instructions: "How much is this problem disrupting the customer's work?",
    criteria: [
      "A question or cosmetic issue; work can continue",
      "Some work is impaired, but a workaround exists",
      "Production work is blocked; no workaround is mentioned",
    ],
  }),
  investigate: Question.noul(
    "Does the message describe a technical symptom that a diagnostic runbook could help investigate?",
  ),
};

const runbookQuestion = Question.choice(Runbook, {
  instructions: "Which of the supplied runbooks is the best first diagnostic for this ticket?",
  criteria: {
    "service-status": "Check current service incidents when multiple requests fail unexpectedly",
    credentials: "Check token scope and rotation when API authentication or authorization fails",
    integration: "Check SDK versions, request formats, and application configuration",
  },
});

const loadRunbooks = Effect.fn("loadRunbooks")(function*() {
  yield* Effect.log("Loading technical runbooks");
  return {
    "service-status":
      "Inspect the status page and compare the incident start time with the ticket.",
    credentials:
      "Compare deploy-token scopes before and after rotation; confirm the active secret.",
    integration: "Compare the failing request with a known-good example and check the SDK version.",
  };
});

const Outcome = Schema.Union([
  Schema.TaggedStruct("Routed", {
    queue: Department,
    priority: Schema.Literals(["normal", "high"]),
  }),
  Schema.TaggedStruct("Diagnosed", {
    runbook: Runbook,
    nextStep: Schema.String,
    priority: Schema.Literals(["normal", "high"]),
  }),
  Schema.TaggedStruct("Clarify", { ticketId: Schema.String, confidence: Question.Probability }),
]);
export type Outcome = typeof Outcome.Type;

export const triage = Effect.fn("triage")(function*(ticket: Ticket) {
  const jev = yield* Jev;

  const { answers, usage } = yield* jev.ask(ticket, triageQuestions);
  yield* Effect.log("Triage evidence", { answers, usage });

  const department = yield* Decision.requireConfidence(answers.department, 0.7);
  const priority = answers.impact.score >= 1.5 ? "high" as const : "normal" as const;
  const route = (queue: typeof Department.Type) =>
    Effect.succeed<Outcome>({ _tag: "Routed", queue, priority });

  return yield* Match.value(department.choice).pipe(
    Match.when("billing", () => route("billing")),
    Match.when("account", () => route("account")),
    Match.when("technical", () =>
      Effect.gen(function*() {
        if (answers.investigate.noul < 0.65) return yield* route("technical");
        const runbooks = yield* loadRunbooks();
        const next = yield* jev.ask(
          { ticket, runbooks },
          { runbook: runbookQuestion },
        );
        yield* Effect.log("Runbook evidence", next.answers.runbook);
        const selected = yield* Decision.requireConfidence(next.answers.runbook, 0.7);
        return {
          _tag: "Diagnosed",
          runbook: selected.choice,
          nextStep: runbooks[selected.choice],
          priority,
        } satisfies Outcome;
      })),
    Match.exhaustive,
  );
}, (effect, { id: ticketId }) =>
  effect.pipe(
    Effect.catchTag("UncertainDecision", ({ confidence }) =>
      Effect.succeed({ _tag: "Clarify", ticketId, confidence })),
  ));
