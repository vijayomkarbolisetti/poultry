import { Redirect } from "expo-router";

/** Backward-compatible alias — Find a bird is now Global Search. */
export default function BirdSearchRedirect() {
  return <Redirect href="/(app)/search" />;
}
