/**
 * Lifecycle detail formatting — non-transfer events must not show a shed move.
 * Run: npx --yes tsx src/features/birds/lifecycleDisplay.test.ts
 */
import type { BirdProfileLifecycle } from "../../api/birds";
import { lifecycleEventDetail } from "./lifecycleDisplay";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function event(overrides: Partial<BirdProfileLifecycle>): BirdProfileLifecycle {
  return {
    id: "e1",
    event_type: "count_adjustment",
    effective_date: "2026-11-07",
    quantity: 1,
    reason: null,
    created_at: "2026-11-07T00:00:00Z",
    ...overrides,
  };
}

assert(
  lifecycleEventDetail(
    event({
      event_type: "count_adjustment",
      reason: "Added 4 unbanded birds",
      to_shed_name: "Shed 1",
    }),
  ) === "Added 4 unbanded birds",
  "non-transfer event ignores shed destination and shows its reason",
);

assert(
  lifecycleEventDetail(
    event({
      event_type: "mortality",
      reason: "Test reason",
      to_shed_name: "Shed 1",
    }),
  ) === "Test reason",
  "mortality shows the recorded reason",
);

assert(
  lifecycleEventDetail(
    event({ event_type: "onboarding", reason: "Birds onboarded", to_shed_name: "Shed 1" }),
  ) === "Birds onboarded",
  "onboarding shows its reason",
);

assert(
  lifecycleEventDetail(
    event({ event_type: "transfer", from_shed_name: "North Shed", to_shed_name: "South Shed" }),
  ) === "From North Shed to South Shed",
  "transfer shows from/to sheds",
);

assert(
  lifecycleEventDetail(event({ event_type: "transfer", to_shed_name: "South Shed" })) ===
    "Transferred to South Shed",
  "transfer shows destination",
);

assert(
  lifecycleEventDetail(
    event({ event_type: "sale", buyer_name: "Naresh", buyer_mobile: "9346071506" }),
  ) === "Buyer Naresh · Mobile 9346071506",
  "sale shows buyer details",
);

console.log("lifecycleDisplay.test.ts OK");
