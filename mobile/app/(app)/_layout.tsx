import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";

import { useAuth } from "../../src/features/auth/AuthContext";
import { colors } from "../../src/theme/tokens";

export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) return <Text style={{ padding: 24 }}>Loading…</Text>;
  if (!user) return <Redirect href="/(auth)/login" />;

  const isOwnerLike = user.memberships.some((m) => m.role === "owner" || m.role === "org_admin");

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.bgElevated, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Dashboard", tabBarLabel: "Home" }} />
      <Tabs.Screen name="sheds/index" options={{ title: "Sheds", tabBarLabel: "Sheds" }} />
      <Tabs.Screen name="sheds/[id]" options={{ href: null, title: "Shed detail" }} />
      <Tabs.Screen name="sheds/create" options={{ href: null, title: "New shed" }} />
      <Tabs.Screen name="flocks/index" options={{ title: "Flocks", tabBarLabel: "Flocks" }} />
      <Tabs.Screen name="flocks/create" options={{ href: null, title: "Onboard flock" }} />
      <Tabs.Screen name="flocks/[id]" options={{ href: null, title: "Flock detail" }} />
      <Tabs.Screen name="vaccines/index" options={{ title: "Vaccines", tabBarLabel: "Vaccines" }} />
      <Tabs.Screen name="doses/index" options={{ title: "Doses", tabBarLabel: "Doses" }} />
      <Tabs.Screen
        name="farmers/index"
        options={{ title: "Farmers", tabBarLabel: "Farmers", href: isOwnerLike ? undefined : null }}
      />
      <Tabs.Screen name="farmers/create" options={{ href: null, title: "Add farmer" }} />
      <Tabs.Screen name="farmers/[id]" options={{ href: null, title: "Farmer" }} />
      <Tabs.Screen name="settings" options={{ title: "Account", tabBarLabel: "Account" }} />
    </Tabs>
  );
}
