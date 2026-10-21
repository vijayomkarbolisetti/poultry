import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { listFarmers } from "../../../src/api/farmers";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { MediaCard } from "../../../src/components/ui/MediaCard";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { media } from "../../../src/theme/media";
import { colors, space } from "../../../src/theme/tokens";

export default function FarmersScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: canManage,
  });

  if (!canManage) return <Redirect href="/(app)/home" />;

  return (
    <Screen style={{ paddingTop: space.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Farm team</Text>
          <Text style={styles.sub}>Invite farmers and control what they can see</Text>
        </View>
        <Button label="Add" onPress={() => router.push("/(app)/farmers/create")} />
      </View>

      {farmers.isError ? <Text style={styles.error}>Could not load farmers</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={farmers.data ?? []}
        keyExtractor={(item) => item.membership_id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          farmers.isLoading ? (
            <HenLoader label="Loading farmers…" />
          ) : (
            <EmptyState
              title="No farmers yet"
              body="Add a farmer, assign sheds, and pick only the permissions they need."
              imageUri={media.farmMorning}
              actionLabel="Add farmer"
              onAction={() => router.push("/(app)/farmers/create")}
            />
          )
        }
        renderItem={({ item }) => (
          <MediaCard
            title={item.full_name}
            subtitle={item.email}
            meta={`${item.permission_codes.length} permissions · ${item.assigned_shed_ids.length} sheds`}
            icon="person"
            badge={item.is_active ? item.role.replace("_", " ") : "inactive"}
            badgeTone={item.is_active ? "good" : "neutral"}
            onPress={() => router.push(`/(app)/farmers/${item.membership_id}`)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  sub: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  error: { color: colors.danger },
});
