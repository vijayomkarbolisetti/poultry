import { Redirect } from "expo-router";

/**
 * Legacy Get Started step — guests land on the unified login screen instead.
 */
export default function WelcomeScreen() {
  return <Redirect href="/(auth)/login" />;
}
