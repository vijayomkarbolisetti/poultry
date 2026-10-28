import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeApiError } from "../../../../src/api/client";
import { getShedOverview } from "../../../../src/api/sheds";
import { Button } from "../../../../src/components/ui/Button";
import { DataQualityBanner } from "../../../../src/components/ui/DataQualityBanner";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import { firstRouteParam } from "../../../../src/navigation/routeParams";
import { safeBack } from "../../../../src/navigation/safeBack";
import { media } from "../../../../src/theme/media";
import { birdUi } from "../../../../src/theme/birdManagementUi";

export default function ShedGroupsScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = firstRouteParam(params.id);
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "flock.view");
  const canCreate = hasPermission(user, ownerAccountId, "flock.create");

  const overview = useQuery({
    queryKey: ["shed-overview", id],
    queryFn: () => getShedOverview(id!),
    enabled: !!id && canView,
  });

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view groups.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(id ? `/(app)/sheds/${id}/birds` : undefined)} />
      </Screen>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <Screen>
        <HenLoader label="Loading groups…" />
      </Screen>
    );
  }

  if (overview.isError) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(overview.error, "load groups")}</Text>
        <Button label="Retry" onPress={() => overview.refetch()} />
      </Screen>
    );
  }

  const { shed, batches } = overview.data;
  const showAdd = canCreate && shed.is_active;

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => safeBack(`/(app)/sheds/${id}/birds`)}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Groups</Text>
          <Text style={styles.sub}>{shed.name}</Text>
        </View>
      </View>

      {showAdd ? (
        <Button
          label="Add unbanded birds"
          onPress={() =>
            router.push({ pathname: "/(app)/birds/add-unbanded", params: { shedId: id! } })
          }
        />
      ) : null}

      {batches.length === 0 ? (
        <EmptyState
          title="No groups yet"
          body={shed.is_active ? "Add birds by headcount to create the first group." : "Shed is inactive."}
          imageUri={media.flockHen}
          actionLabel={showAdd ? "Add unbanded birds" : undefined}
          onAction={
            showAdd
              ? () => router.push({ pathname: "/(app)/birds/add-unbanded", params: { shedId: id! } })
              : undefined
          }
        />
      ) : (
        batches.map((b) => {
          const hatch =
            b.hatch_date ??
            (b.estimated_age_days != null ? `~${b.estimated_age_days}d` : "Age unknown");
          return (
            <Pressable
              key={b.id}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
              onPress={() => router.push(`/(app)/flocks/${b.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open hatch ${hatch}`}
            >
              <View style={styles.cardTop}>
                <Text style={styles.code}>{hatch.startsWith("~") || hatch === "Age unknown" ? hatch : `Hatch ${hatch}`}</Text>
                <Text style={styles.status}>{b.status}</Text>
              </View>
              <Text style={styles.meta}>{b.breed ?? "Mixed / unknown breed"}</Text>
              <Text style={styles.count}>{b.current_count} live</Text>
              <Text style={styles.meta}>
                Banded {b.banded_count} · Unbanded {b.unbanded_count}
              </Text>
              {b.count_mismatch ? (
                <DataQualityBanner message="Counts need reconciliation for this group." />
              ) : null}
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: birdUi.text },
  sub: { fontSize: 13, color: birdUi.muted },
  card: {
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 4,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code: { fontSize: 17, fontWeight: "800", color: birdUi.text },
  status: {
    fontSize: 11,
    fontWeight: "700",
    color: birdUi.primary,
    backgroundColor: birdUi.paleMint,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
    textTransform: "capitalize",
  },
  meta: { fontSize: 13, color: birdUi.muted },
  count: { fontSize: 15, fontWeight: "700", color: birdUi.text, marginTop: 4 },
  error: { color: birdUi.error, fontWeight: "600" },
});
