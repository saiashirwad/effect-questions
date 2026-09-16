import { Effect, Schema } from "effect";
import { Answer, Decision, Question, QuestionModel } from "../src/index.ts";

const Department = Schema.Literals(["billing", "technical", "account"]);

export const Ticket = Schema.Struct({ id: Schema.NonEmptyString, message: Schema.NonEmptyString });
export type Ticket = typeof Ticket.Type;

const assessment = {
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
  investigate: Question.boolean(
    "Does the message describe a technical symptom that diagnostics could help investigate?",
  ),
};

const loadDiagnostics = Effect.fn("loadDiagnostics")(function*() {
  yield* Effect.log("Loading available diagnostics");
  return {
    "service-status": {
      summary: "Inspect current incidents when multiple requests fail unexpectedly",
      inspect: Effect.succeed({
        finding:
          "The saved status snapshot reports no active incidents; API error rates are normal.",
        nextStep: "Investigate this customer's integration rather than an ongoing service outage.",
      }),
    },
    credentials: {
      summary:
        "Compare token scopes before and after rotation when API authentication or authorization fails",
      inspect: Effect.succeed({
        finding:
          "The saved configuration shows the previous token had deploy:write. The rotated token only has deploy:read. The deployment endpoint requires deploy:write.",
        nextStep: "Restore the deploy:write scope on the deployment token, then retry the release.",
      }),
    },
    integration: {
      summary: "Compare SDK versions, request formats, and application configuration",
      inspect: Effect.succeed({
        finding:
          "The saved deployment manifest uses the same SDK version and request format as the last successful release.",
        nextStep:
          "Compare credentials and service status; no SDK or request-format change was found.",
      }),
    },
  };
});

const diagnose = Effect.fn("diagnose")(function*(ticket: Ticket) {
  const candidates = yield* loadDiagnostics();
  const selection = yield* QuestionModel.choose({
    state: ticket,
    instructions: "Which available diagnostic is the best first investigation for this ticket?",
    candidates,
    describe: (candidate) => candidate.summary,
  });
  yield* Effect.log("Diagnostic evidence", {
    choice: selection.choice,
    alternatives: Answer.topK(selection, 2),
    margin: Answer.margin(selection),
    usage: selection.usage,
  });

  const accepted = yield* Decision.requireConfidence(selection, 0.7);
  const observation = yield* accepted.value.inspect;
  const verification = yield* QuestionModel.evaluate({ ticket, observation }, {
    supported: Question.boolean(
      "Does the diagnostic finding explain the technical symptom reported in this ticket?",
    ),
    helpful: Question.boolean(
      "Would the proposed next step help address the reported problem, given the diagnostic finding?",
    ),
  });

  const decision = yield* Decision.minimizeLoss(
    Answer.fromBoolean(verification.answers.supported),
    {
      recommend: (supported) => supported === "true" ? 0 : 10,
      investigateFurther: () => 1,
    },
  );
  yield* Effect.log("Verification evidence", { answers: verification.answers, decision });

  if (decision.action === "investigateFurther" || verification.answers.helpful.probability < 0.8) {
    return { _tag: "InvestigateFurther" as const, diagnostic: selection.choice, observation };
  }
  return { _tag: "Recommendation" as const, diagnostic: selection.choice, ...observation };
});

export const triage = Effect.fn("triage")(function*(ticket: Ticket) {
  const { answers, usage } = yield* QuestionModel.evaluate(ticket, assessment);
  yield* Effect.log("Triage evidence", { answers, usage });

  const department = yield* Decision.requireConfidence(answers.department, 0.7);
  const priority = answers.impact.score >= 1.5 ? "high" as const : "normal" as const;
  const route = (queue: typeof Department.Type) =>
    Effect.succeed({ _tag: "Routed" as const, queue, priority });

  return yield* Decision.match(department, {
    billing: ({ choice }) => route(choice),
    account: ({ choice }) => route(choice),
    technical: () =>
      answers.investigate.probability >= 0.65 ? diagnose(ticket) : route("technical"),
  });
}, (effect, { id: ticketId }) =>
  effect.pipe(
    Effect.catchTag("UncertainDecision", ({ confidence }) =>
      Effect.succeed({ _tag: "Clarify" as const, ticketId, confidence })),
  ));
