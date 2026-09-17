import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev, Question, Questions } from "../src/index.ts";

type Message = { readonly from: "customer" | "agent"; readonly text: string; };

const transcript: ReadonlyArray<Message> = [
  { from: "customer", text: "Hi, I was charged twice for my subscription this month." },
  { from: "agent", text: "Sorry about that. Could you share the invoice numbers?" },
  { from: "customer", text: "INV-2041 and INV-2042, both on the 3rd, same amount." },
  { from: "agent", text: "I see both. INV-2042 looks like a retry that should not have settled." },
  {
    from: "customer",
    text: "So when do I get my money back? This is the second month in a row. "
      + "If this is not fixed today I am cancelling and disputing the charge.",
  },
  {
    from: "agent",
    text: "I have refunded INV-2042; it lands in 3-5 business days. The retry bug is flagged.",
  },
  { from: "customer", text: "Okay, I can see the refund pending now. Thanks for sorting it." },
  { from: "agent", text: "Glad to help. Anything else?" },
  { from: "customer", text: "No, that is all." },
];

const questions = {
  stage: Question.choice("After the latest customer message, where does the conversation stand?", {
    open: "The problem is still being worked out",
    escalated: "The customer threatens to leave or dispute, or asks for a manager",
    resolved: "The customer confirms the problem is solved and needs nothing more",
  }),
  temperature: Question.score("How is the customer feeling right now?", [
    "Calm",
    "Frustrated",
    "Very angry",
  ]),
};
type Stage = Questions.Values<typeof questions>["stage"];

const assess = (log: ReadonlyArray<Message>) => Questions.about({ transcript: log }).ask(questions);

/** Escalation sticks until the conversation resolves; the model never un-escalates. */
const advance = (current: Stage, observed: Stage): Stage =>
  current === "escalated" && observed === "open" ? "escalated" : observed;

/** The transcript so far, emitted once per customer message. */
const customerTurns = Stream.fromIterable(transcript).pipe(
  Stream.scan([] as ReadonlyArray<Message>, (log, message) => [...log, message]),
  Stream.filter((log) => log.at(-1)?.from === "customer"),
);

/** Judges one turn, advances the stage, and emits what happened. */
const step = (stage: Stage, log: ReadonlyArray<Message>) =>
  assess(log).pipe(Effect.map(({ stage: observed, temperature }) => {
    const next = advance(stage, observed);
    const event = { turn: log.length, stage: next, changed: next !== stage, temperature };
    return [next, [event]] as const;
  }));

const reactions: Record<Stage, string> = {
  open: "",
  escalated: "  -> paging a senior agent",
  resolved: "  -> closing the ticket and sending the survey",
};

const workflow = customerTurns.pipe(
  Stream.mapAccumEffect(() => "open" as Stage, step),
  Stream.takeUntil((event) => event.stage === "resolved"),
  Stream.runForEach((event) =>
    Effect.gen(function*() {
      yield* Console.log(
        `turn ${event.turn}  ${event.stage}  temperature ${event.temperature.toFixed(1)}`,
      );
      if (event.changed) yield* Console.log(reactions[event.stage]);
    })
  ),
);

const QuestionsLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(workflow.pipe(Effect.timeout("1 minute"), Effect.provide(QuestionsLive)));
