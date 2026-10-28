import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { listFlocks } from "../../../src/api/flocks";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { MediaCard } from "../../../src/components/ui/MediaCard";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { media } from "../../../src/theme/media";
import { colors, space } from "../../../src/theme/tokens";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
];

export default function FlocksScreen() {
  const { ownerAccountId, user } = useAuth();
  const canCreate = hasPermission(user, ownerAccountId, "flock.create");
  const [shedFilter, setShedFilter] = useState<string | null>("all");
  const [statusFilter, setStatusFilter] = useState<string | null>("active");

  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: () => listSheds() });
  const shedIdParam = shedFilter && shedFilter !== "all" ? shedFilter : undefined;
  const flocks = useQuery({
    queryKey: ["flocks", ownerAccountId, shedIdParam ?? "all"],
    queryFn: () => listFlocks(shedIdParam),
  });

  const shedOptions = useMemo(
    () => [
      { value: "all", label: "All sheds", hint: "Every accessible shed" },
      ...(sheds.data ?? [])
        .filter((s) => s.is_active)
        .map((s) => ({ value: s.id, label: s.name, hint: s.code })),
    ],
    [sheds.data],
  );

  const data = useMemo(() => {
    let rows = flocks.data ?? [];
    if (statusFilter && statusFilter !== "all") {
      rows = rows.filter((f) => f.status === statusFilter);
    }
    return rows;
  }, [flocks.data, statusFilter]);

  return (
    <Screen style={{ paddingTop: space.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Shed populations</Text>
          <Text style={styles.sub}>
            {data
              ? `${data.length} hatch-date population${data.length === 1 ? "" : "s"}`
              : "Birds by shed hatch date"}
          </Text>
        </View>
        {canCreate ? <Button label="Add birds" onPress={() => router.push("/(app)/flocks/create")} /> : null}
      </View>

      <SelectField
        label="Shed"
        value={shedFilter}
        options={shedOptions}
        onChange={setShedFilter}
        allowValues={["all"]}
        searchable
        loading={sheds.isLoading}
      />
      <SelectField
        label="Status"
        value={statusFilter}
        options={STATUS_OPTIONS}
        onChange={setStatusFilter}
        allowValues={["all"]}
        clearStale={false}
      />

      {flocks.isError ? <Text style={styles.error}>Could not load populations</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={data}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          flocks.isLoading ? (
            <HenLoader label="Loading populations…" />
          ) : (
            <EmptyState
              title="No populations yet"
              body="Add birds in a shed to track ages and populations in one place."
              imageUri={media.flockHen}
              actionLabel={canCreate ? "Add birds" : undefined}
              onAction={canCreate ? () => router.push("/(app)/flocks/create") : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <MediaCard
            title={
              item.hatch_date
                ? `Hatch ${item.hatch_date}`
                : item.estimated_age_days != null
                  ? `~${item.estimated_age_days}d`
                  : "Age unknown"
            }
            subtitle={item.breed ? `${item.breed}` : "Mixed / unknown breed"}
            meta={`${item.current_count} hens · ${item.tracking_mode} · ${item.dob_confidence} age`}
            imageUri={media.flockHen}
            icon="egg"
            badge={item.count_mismatch ? "Check count" : item.status}
            badgeTone={item.count_mismatch ? "warn" : "good"}
            onPress={() => router.push(`/(app)/flocks/${item.id}`)}
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
