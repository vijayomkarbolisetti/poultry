import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { listFlocks } from "../../../src/api/flocks";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { MediaCard } from "../../../src/components/ui/MediaCard";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { media } from "../../../src/theme/media";
import { colors, space } from "../../../src/theme/tokens";

export default function FlocksScreen() {
  const { ownerAccountId, user } = useAuth();
  const canCreate = hasPermission(user, ownerAccountId, "flock.create");
  const flocks = useQuery({ queryKey: ["flocks", ownerAccountId], queryFn: () => listFlocks() });

  return (
    <Screen style={{ paddingTop: space.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Hens & flocks</Text>
          <Text style={styles.sub}>
            {flocks.data ? `${flocks.data.length} active flock${flocks.data.length === 1 ? "" : "s"}` : "Your hen groups"}
          </Text>
        </View>
        {canCreate ? <Button label="Add flock" onPress={() => router.push("/(app)/flocks/create")} /> : null}
      </View>

      {flocks.isError ? <Text style={styles.error}>Could not load flocks</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={flocks.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          flocks.isLoading ? (
            <HenLoader label="Loading flocks…" />
          ) : (
            <EmptyState
              title="No flocks yet"
              body="Start a flock to track hens, ages, and vaccination plans in one place."
              imageUri={media.flockHen}
              actionLabel={canCreate ? "Onboard first flock" : undefined}
              onAction={canCreate ? () => router.push("/(app)/flocks/create") : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <MediaCard
            title={item.batch_code}
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
