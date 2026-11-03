import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { ComponentProps, type ReactNode } from "react";
import {
  ColorValue,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HenLoader } from "../../src/components/ui/HenLoader";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { safeBack } from "../../src/navigation/safeBack";
import { colors, typography } from "../../src/theme/tokens";

/** Content height for icon + label inside each tab (excludes Android gesture inset). */
const TAB_BAR_CONTENT_HEIGHT = 56;
const TAB_ACTIVE_BG = "#E5F5EF";

type TabBarButtonProps = {
  children?: ReactNode;
  onPress?: ((e: GestureResponderEvent) => void) | null;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** React Navigation bottom tabs pass focus via aria-selected, not accessibilityState. */
  "aria-selected"?: boolean;
  role?: "button" | "tab" | "link";
};

/**
 * Stretch tab pressable to the full item height so tabBarActiveBackgroundColor
 * (applied on the button style by BottomTabItem) fills the tab, not a padded island.
 */
function FullHeightTabButton({
  children,
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
  style,
  "aria-selected": ariaSelected,
  role = "button",
}: TabBarButtonProps) {
  return (
    <Pressable
      onPress={onPress ?? undefined}
      onLongPress={onLongPress ?? undefined}
      accessibilityRole={role === "tab" ? "tab" : "button"}
      accessibilityState={{ selected: !!ariaSelected }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      android_ripple={{ color: "rgba(7, 131, 93, 0.12)", borderless: false }}
      style={[style, styles.tabButtonFill]}
    >
      {children}
    </Pressable>
  );
}

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(active: IconName, inactive: IconName) {
  function TabBarIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
  }
  TabBarIcon.displayName = `TabBarIcon(${active})`;
  return TabBarIcon;
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
  const insets = useSafeAreaInsets();

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
  const bottomInset = Math.max(insets.bottom, 0);

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800", color: colors.ink, fontSize: typography.screenTitle.fontSize },
        tabBarActiveTintColor: "#07835D",
        tabBarInactiveTintColor: "#8A9A93",
        // BottomTabItem paints this onto the tabBarButton style when focused.
        tabBarActiveBackgroundColor: TAB_ACTIVE_BG,
        tabBarInactiveBackgroundColor: "transparent",
        tabBarButton: (props) => (
          <FullHeightTabButton
            onPress={props.onPress}
            onLongPress={props.onLongPress}
            accessibilityLabel={props.accessibilityLabel}
            testID={props.testID}
            style={props.style as StyleProp<ViewStyle>}
            aria-selected={props["aria-selected"]}
            role={props.role === "tab" || props.role === "link" ? props.role : "button"}
          >
            {props.children}
          </FullHeightTabButton>
        ),
        /**
         * No vertical margin — that previously left white gaps above/below the
         * pale-green active fill. Horizontal gap only; height matches content row.
         */
        tabBarItemStyle: {
          height: TAB_BAR_CONTENT_HEIGHT,
          padding: 0,
          marginVertical: 0,
          marginHorizontal: 4,
          borderRadius: 14,
          overflow: "hidden",
          justifyContent: "center",
        },
        tabBarLabelStyle: {
          fontSize: typography.caption.fontSize,
          fontWeight: "700",
          marginBottom: 0,
          marginTop: 2,
        },
        tabBarIconStyle: { marginTop: 0 },
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E8F0EB",
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
          paddingTop: 0,
          paddingBottom: bottomInset,
          paddingHorizontal: 4,
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
        options={{
          title: "More",
          tabBarLabel: "More",
          headerShown: false,
          tabBarIcon: tabIcon("menu", "menu-outline"),
        }}
      />

      <Tabs.Screen name="sheds/[id]/index" options={hidden("Shed")} />
      <Tabs.Screen name="sheds/[id]/groups" options={hidden("Groups")} />
      <Tabs.Screen name="sheds/[id]/birds" options={hidden("Shed management")} />
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
      <Tabs.Screen name="birds/sold" options={hidden("Sold Birds")} />
      <Tabs.Screen name="birds/dead-birds" options={hidden("Dead Birds")} />
      <Tabs.Screen name="birds/dead" options={hidden("Dead Birds")} />
      <Tabs.Screen name="birds/record-vaccination" options={hidden("Record vaccination")} />
      <Tabs.Screen name="lifecycle-bulk" options={hidden("Bulk lifecycle")} />
      <Tabs.Screen name="lifecycle-batch" options={hidden("Unbanded count action")} />
      <Tabs.Screen name="farmers/index" options={hidden("Farmers")} />
      <Tabs.Screen name="farmers/create" options={hidden("Add farmer")} />
      <Tabs.Screen name="farmers/[id]" options={hidden("Farmer")} />
      <Tabs.Screen name="farms/index" options={hidden("All farms")} />
      <Tabs.Screen name="farms/create" options={hidden("Create farm")} />
      <Tabs.Screen name="catalogues/index" options={hidden("Catalogues")} />
      <Tabs.Screen name="catalogues/create" options={hidden("Create catalogue")} />
      <Tabs.Screen name="catalogues/[id]" options={hidden("Catalogue")} />
      <Tabs.Screen name="catalogues/item-edit" options={hidden("Edit vaccine")} />
      <Tabs.Screen name="vaccination/[id]" options={hidden("Vaccination details")} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButtonFill: {
    flex: 1,
    alignSelf: "stretch",
    height: "100%",
    minHeight: TAB_BAR_CONTENT_HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
});
