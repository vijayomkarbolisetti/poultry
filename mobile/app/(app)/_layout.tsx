import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, router, Tabs } from "expo-router";
import { ComponentProps } from "react";
import { ActivityIndicator, ColorValue, Pressable, View } from "react-native";

import { useAuth } from "../../src/features/auth/AuthContext";
import { colors } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(active: IconName, inactive: IconName) {
  return ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color} />
  );
}

function HeaderButton({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      style={({ pressed }) => ({ paddingHorizontal: 16, opacity: pressed ? 0.5 : 1 })}
    >
      <Ionicons name={icon} size={24} color={colors.brand} />
    </Pressable>
  );
}

const accountButton = () => (
  <HeaderButton icon="person-circle-outline" label="Account" onPress={() => router.push("/(app)/settings")} />
);
const backButton = () => <HeaderButton icon="arrow-back" label="Back" onPress={() => router.back()} />;

/** Screens reachable by navigation but not shown in the tab bar. */
const hidden = (title: string) => ({ href: null, title, headerLeft: backButton });

export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800", color: colors.ink, fontSize: 20 },
        headerRight: accountButton,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarStyle: { backgroundColor: colors.bgElevated, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", headerShown: false, tabBarIcon: tabIcon("home", "home-outline") }}
      />
      <Tabs.Screen name="sheds/index" options={{ title: "Sheds", tabBarIcon: tabIcon("business", "business-outline") }} />
      <Tabs.Screen name="flocks/index" options={{ title: "Flocks", tabBarIcon: tabIcon("egg", "egg-outline") }} />
      <Tabs.Screen
        name="vaccines/index"
        options={{ title: "Vaccines", tabBarIcon: tabIcon("medkit", "medkit-outline") }}
      />
      <Tabs.Screen
        name="doses/index"
        options={{ title: "Doses", tabBarIcon: tabIcon("calendar", "calendar-outline") }}
      />

      <Tabs.Screen name="sheds/[id]" options={hidden("Shed")} />
      <Tabs.Screen name="sheds/create" options={hidden("New shed")} />
      <Tabs.Screen name="flocks/[id]" options={hidden("Flock")} />
      <Tabs.Screen name="flocks/create" options={hidden("Onboard flock")} />
      <Tabs.Screen name="farmers/index" options={hidden("Farmers")} />
      <Tabs.Screen name="farmers/create" options={hidden("Add farmer")} />
      <Tabs.Screen name="farmers/[id]" options={hidden("Farmer")} />
      <Tabs.Screen name="settings" options={{ ...hidden("Account"), headerRight: undefined }} />
    </Tabs>
  );
}
