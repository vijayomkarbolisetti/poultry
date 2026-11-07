import Ionicons from "@expo/vector-icons/Ionicons";
import { Href, router } from "expo-router";
import { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "../../src/components/ui/Screen";
import type { Membership } from "../../src/api/auth";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { colors, layout, radius, shadow, space, typography } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

const ui = {
  bg: "#F1F8F5",
  deep: "#176B45",
  ink: "#102A22",
  muted: "#6B7C75",
  mint: "#E8F6F0",
  border: "#D7E4DE",
  card: "#FFFFFF",
  danger: "#D64545",
} as const;

function roleLabel(role: string | undefined): string {
  if (!role) return "Member";
  return role.replace(/_/g, " ");
}

function initials(name: string | undefined | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function MenuRow({
  label,
  description,
  icon,
  href,
  isLast,
}: {
  label: string;
  description?: string;
  icon: IconName;
  href: Href;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={description ? `${label}. ${description}` : label}
      style={({ pressed }) => [styles.row, !isLast && styles.rowBorder, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={ui.deep} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={styles.rowHint} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={ui.muted} />
    </Pressable>
  );
}

function OrgCard({
  membership,
  active,
  onSwitch,
}: {
  membership: Membership;
  active: boolean;
  onSwitch: () => void;
}) {
  const name = membership.organization_name?.trim() || "Farm";
  const role = roleLabel(membership.role);
  const status = membership.is_active === false ? "Inactive" : active ? "Active" : "Available";
  const canSwitch = !active;

  return (
    <Pressable
      onPress={canSwitch ? onSwitch : undefined}
      disabled={!canSwitch}
      accessibilityRole={canSwitch ? "button" : "summary"}
      accessibilityLabel={`${name}, ${role}, ${status}${canSwitch ? ". Switch to this organization" : ""}`}
      style={({ pressed }) => [
        styles.orgCard,
        shadow.card,
        pressed && canSwitch && styles.pressed,
      ]}
    >
      <View style={styles.orgIcon}>
        <Ionicons name="business-outline" size={20} color={ui.deep} />
      </View>
      <View style={styles.orgCopy}>
        <Text style={styles.orgName} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.orgMetaRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  status === "Active" ? ui.deep : status === "Inactive" ? colors.inkMuted : colors.secondary,
              },
            ]}
          />
          <Text style={styles.orgMeta} numberOfLines={1}>
            {role} · {status}
          </Text>
        </View>
      </View>
      {canSwitch ? <Text style={styles.switchHint}>Switch</Text> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, ownerAccountId, setActiveOwner, signOut } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const isSuperAdmin = Boolean(user?.is_platform_super_admin);
  const canFarmers = hasPermission(user, ownerAccountId, "farmer.manage");
  const canCatalogues = hasPermission(user, ownerAccountId, "schedule.view");
  const canBirdHistory = hasPermission(user, ownerAccountId, "bird.view");
  const canSicknessHistory = hasPermission(user, ownerAccountId, "sickness.view");

  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  const manageItems: {
    key: string;
    label: string;
    description: string;
    icon: IconName;
    href: Href;
    show: boolean;
  }[] = [
    {
      key: "settings",
      label: "Settings",
      description: "Username and password",
      icon: "settings-outline",
      href: "/(app)/account/settings",
      show: true,
    },
    {
      key: "farms",
      label: "All farms",
      description: "Create farms and open any organization",
      icon: "globe-outline",
      href: "/(app)/farms",
      show: isSuperAdmin,
    },
    {
      key: "farmers",
      label: "Farmers",
      description: "Manage farm workers and access",
      icon: "people-outline",
      href: "/(app)/farmers",
      show: canFarmers,
    },
    {
      key: "sold",
      label: "Sold Birds",
      description: "View sales and sold-bird history",
      icon: "pricetag-outline",
      href: "/(app)/birds/sold",
      show: canBirdHistory,
    },
    {
      key: "dead",
      label: "Dead Birds",
      description: "View mortality and dead-bird history",
      icon: "heart-dislike-outline",
      href: "/(app)/birds/dead-birds",
      show: canBirdHistory,
    },
    {
      key: "sick",
      label: "Sick Birds",
      description: "View sickness episodes, follow-ups, and recovery",
      icon: "medkit-outline",
      href: "/(app)/birds/sick-birds",
      show: canSicknessHistory,
    },
    {
      key: "catalogues",
      label: "Catalogues",
      description: "Manage vaccination catalogues",
      icon: "book-outline",
      href: "/(app)/catalogues",
      show: canCatalogues,
    },
  ];
  const visibleManage = manageItems.filter((i) => i.show);
  const role = roleLabel(membership?.role);
  const isOwner = membership?.role === "owner";

  return (
    <Screen
      scroll
      edges={["left", "right"]}
      style={{
        paddingTop: Math.max(insets.top, 10) + 4,
        paddingBottom: space.lg,
        backgroundColor: ui.bg,
        gap: space.md,
      }}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>More</Text>
        </View>
        <Pressable
          onPress={() => router.push("/(app)/account/settings")}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={({ pressed }) => [styles.settingsBadge, pressed && styles.pressed]}
          hitSlop={6}
        >
          <Ionicons name="settings-outline" size={18} color={ui.deep} />
        </Pressable>
      </View>

      {/* Account summary — display only (no profile route / no chevron) */}
      <View
        style={[styles.profileCard, shadow.card]}
        accessibilityRole="summary"
        accessibilityLabel={`Account ${user?.full_name ?? ""}, ${user?.email ?? ""}, ${role}`}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(user?.full_name)}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.name} numberOfLines={1}>
            {user?.full_name || "Account"}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {user?.email}
          </Text>
          <View style={styles.profileMeta}>
            <View style={[styles.roleBadge, (isOwner || isSuperAdmin) && styles.roleBadgeOwner]}>
              {isOwner || isSuperAdmin ? (
                <Ionicons name="shield-checkmark" size={11} color="#fff" />
              ) : null}
              <Text style={styles.roleBadgeText} numberOfLines={1}>
                {isSuperAdmin ? "platform admin" : role}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Manage */}
      <Text style={styles.section}>Manage</Text>
      <View style={[styles.card, shadow.card]}>
        {visibleManage.length === 0 ? (
          <Text style={styles.emptyManage}>No manage options available for your role.</Text>
        ) : (
          visibleManage.map((item, index) => (
            <MenuRow
              key={item.key}
              label={item.label}
              description={item.description}
              icon={item.icon}
              href={item.href}
              isLast={index === visibleManage.length - 1}
            />
          ))
        )}
      </View>

      {/* Organizations — memberships; super admins also use All farms */}
      <Text style={styles.section}>Organizations</Text>
      <View style={styles.orgList}>
        {(user?.memberships ?? []).length === 0 ? (
          <Text style={styles.emptyManage}>
            {isSuperAdmin
              ? "No personal farm memberships. Open a farm from All farms."
              : "No organizations linked to this account."}
          </Text>
        ) : (
          (user?.memberships ?? []).map((m) => (
            <OrgCard
              key={m.id}
              membership={m}
              active={m.owner_account_id === ownerAccountId}
              onSwitch={() => setActiveOwner(m.owner_account_id)}
            />
          ))
        )}
      </View>

      {/* Log out — same session clear as before */}
      <Pressable
        onPress={onSignOut}
        accessibilityRole="button"
        accessibilityLabel="Log out"
        style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
      >
        <Ionicons name="log-out-outline" size={20} color="#fff" />
        <Text style={styles.logoutLabel}>Log out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: ui.deep,
    letterSpacing: -0.4,
  },
  settingsBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ui.border,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: ui.card,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: ui.border,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: typography.bodyStrong.fontSize,
    fontWeight: "800",
    color: ui.deep,
  },
  profileCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  name: {
    fontSize: typography.button.fontSize,
    fontWeight: "800",
    color: ui.ink,
  },
  email: {
    fontSize: typography.secondary.fontSize,
    color: ui.muted,
    fontWeight: "500",
  },
  profileMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  farmLine: {
    flexShrink: 1,
    fontSize: typography.secondary.fontSize,
    fontWeight: "700",
    color: ui.deep,
    textTransform: "capitalize",
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: ui.deep,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  roleBadgeOwner: {
    backgroundColor: ui.deep,
  },
  roleBadgeText: {
    color: "#fff",
    fontSize: typography.overline.fontSize,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  section: {
    fontSize: typography.caption.fontSize,
    fontWeight: "800",
    color: ui.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 2,
    marginBottom: -4,
  },
  card: {
    backgroundColor: ui.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ui.border,
    overflow: "hidden",
  },
  emptyManage: {
    padding: space.md,
    color: ui.muted,
    fontSize: typography.label.fontSize,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    minHeight: layout.touchTarget,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ui.border,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: typography.label.fontSize,
    fontWeight: "700",
    color: ui.ink,
  },
  rowHint: {
    fontSize: typography.caption.fontSize,
    color: ui.muted,
    fontWeight: "500",
  },
  orgList: {
    gap: space.sm,
  },
  orgCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: ui.card,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: ui.border,
    minHeight: layout.touchTarget,
  },
  orgIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  orgCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  orgName: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: ui.ink,
  },
  orgMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  orgMeta: {
    flexShrink: 1,
    fontSize: typography.secondary.fontSize,
    color: ui.muted,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  switchHint: {
    fontSize: typography.secondary.fontSize,
    fontWeight: "800",
    color: ui.deep,
  },
  logoutBtn: {
    marginTop: space.sm,
    minHeight: layout.buttonMinHeight,
    borderRadius: radius.md,
    backgroundColor: ui.danger,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: space.lg,
  },
  logoutLabel: {
    color: "#fff",
    fontSize: typography.button.fontSize,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.88,
  },
});
