import { NodeRuntime } from "@effect/platform-node";
import { Config, Console, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Jev } from "../src/index.ts";
import { Ticket, triage } from "./triage.ts";

const message =
  "Our production deployments started failing with HTTP 403 immediately after we rotated "
  + "the deploy API token. The dashboard works. All releases are blocked and we have no workaround.";

const main = Effect.gen(function*() {
  const ticket = yield* Schema.decodeUnknownEffect(Ticket)({ id: "demo-001", message });
  const [elapsed, outcome] = yield* triage(ticket).pipe(Effect.timed);
  yield* Console.log("\nOutcome:", outcome, "\nElapsed:", elapsed.toString());
});

const JevLive = Jev.layerConfig({
  apiKey: Config.Redacted("TYPESAFE_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer));

NodeRuntime.runMain(main.pipe(Effect.timeout("15 seconds"), Effect.provide(JevLive)));
