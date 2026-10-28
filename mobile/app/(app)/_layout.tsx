import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { ComponentProps } from "react";
import { ColorValue, Pressable, StyleSheet, View } from "react-native";

import { HenLoader } from "../../src/components/ui/HenLoader";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { safeBack } from "../../src/navigation/safeBack";
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

const backButton = () => <HeaderButton icon="arrow-back" label="Back" onPress={() => safeBack()} />;
/** Hidden routes use in-screen headers — never stack a second Tab header/back button. */
const hidden = (title: string) => ({
  href: null as null,
  title,
  headerShown: false as const,
  // Keep headerLeft for any future headerShown:true callers; unused while headerShown is false.
  headerLeft: backButton,
});

export default function AppLayout() {
  const { user, loading, ownerAccountId } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <HenLoader label="Opening your farm…" />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;

  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const canVaccination = hasPermission(user, ownerAccountId, "vaccination.view");

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800", color: colors.ink, fontSize: 18 },
        tabBarActiveTintColor: "#07835D",
        tabBarInactiveTintColor: "#8A9A93",
        tabBarActiveBackgroundColor: "#E5F5EF",
        tabBarItemStyle: { borderRadius: 14, marginHorizontal: 2, marginVertical: 4 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginBottom: 4 },
        tabBarIconStyle: { marginTop: 2 },
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E8F0EB",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          height: 68,
          paddingTop: 6,
          paddingBottom: 6,
          elevation: 10,
          shadowColor: "#022C22",
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
        },
        sceneStyle: { backgroundColor: "#F1F8F5" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", headerShown: false, tabBarIcon: tabIcon("home", "home-outline") }}
      />
      <Tabs.Screen
        name="sheds/index"
        options={{
          title: "Sheds",
          headerShown: false,
          href: canSheds ? undefined : null,
          tabBarIcon: tabIcon("business", "business-outline"),
        }}
      />
      <Tabs.Screen
        name="vaccination/index"
        options={{
          title: "Vaccination",
          tabBarLabel: "Vaccination",
          headerShown: false,
          href: canVaccination ? undefined : null,
          tabBarIcon: tabIcon("medkit", "medkit-outline"),
        }}
      />
      <Tabs.Screen
        name="flocks/index"
        options={{
          title: "Populations",
          tabBarLabel: "Populations",
          // Legacy flocks list stays reachable from deep links / manage flows, not the primary tab bar.
          href: null,
          tabBarIcon: tabIcon("egg", "egg-outline"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "More", tabBarLabel: "More", tabBarIcon: tabIcon("menu", "menu-outline") }}
      />

      <Tabs.Screen name="sheds/[id]/index" options={hidden("Shed overview")} />
      <Tabs.Screen name="sheds/[id]/groups" options={hidden("Groups")} />
      <Tabs.Screen name="sheds/[id]/birds" options={hidden("Birds")} />
      <Tabs.Screen name="sheds/create" options={hidden("New shed")} />
      <Tabs.Screen name="sheds/edit/[id]" options={hidden("Edit shed")} />
      <Tabs.Screen name="flocks/[id]" options={hidden("Population")} />
      <Tabs.Screen name="flocks/create" options={hidden("Add birds")} />
      <Tabs.Screen name="search" options={hidden("Search")} />
      <Tabs.Screen name="birds/search" options={hidden("Search")} />
      <Tabs.Screen name="birds/[id]" options={hidden("Bird profile")} />
      <Tabs.Screen name="birds/add" options={hidden("Register banded birds")} />
      <Tabs.Screen name="birds/add-unbanded" options={hidden("Add unbanded birds")} />
      <Tabs.Screen name="birds/band-from-unbanded" options={hidden("Register band from unbanded")} />
      <Tabs.Screen name="birds/transfer" options={hidden("Transfer birds")} />
      <Tabs.Screen name="birds/new-group" options={hidden("New group")} />
      <Tabs.Screen name="birds/group-created" options={hidden("Group created")} />
      <Tabs.Screen name="birds/bird-added" options={hidden("Bird added")} />
      <Tabs.Screen name="birds/edit/[id]" options={hidden("Change band number")} />
      <Tabs.Screen name="lifecycle-bulk" options={hidden("Bulk lifecycle")} />
      <Tabs.Screen name="lifecycle-batch" options={hidden("Unbanded count action")} />
      <Tabs.Screen name="farmers/index" options={hidden("Farmers")} />
      <Tabs.Screen name="farmers/create" options={hidden("Add farmer")} />
      <Tabs.Screen name="farmers/[id]" options={hidden("Farmer")} />
      <Tabs.Screen name="catalogues/index" options={hidden("Catalogues")} />
      <Tabs.Screen name="catalogues/create" options={hidden("Create catalogue")} />
      <Tabs.Screen name="catalogues/[id]" options={hidden("Catalogue")} />
      <Tabs.Screen name="catalogues/item-edit" options={hidden("Edit vaccine")} />
      <Tabs.Screen name="vaccination/[id]" options={hidden("Vaccination details")} />
    </Tabs>
  );
}
