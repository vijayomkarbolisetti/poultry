import { Redirect } from "expo-router";

/** Legacy path — Expo may also match birds/[id] with id="dead"; redirect to the list. */
export default function DeadBirdsLegacyRedirect() {
  return <Redirect href="/(app)/birds/dead-birds" />;
}
