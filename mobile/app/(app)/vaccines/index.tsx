import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Image, StyleSheet, Text, TextInput, View } from "react-native";

import { createVaccine, listVaccines } from "../../../src/api/vaccines";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { MediaCard } from "../../../src/components/ui/MediaCard";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { media } from "../../../src/theme/media";
import { colors, radius, shadow, space } from "../../../src/theme/tokens";

export default function VaccinesScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "schedule.manage");
  const qc = useQueryClient();
  const vaccines = useQuery({ queryKey: ["vaccines", ownerAccountId], queryFn: listVaccines });
  const [name, setName] = useState("");
  const [ageDays, setAgeDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onCreate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await createVaccine({
        name,
        rules: [{ target_age_days: Number(ageDays) || 1, grace_period_days: 0, reminder_lead_days: 3 }],
      });
      setName("");
      setAgeDays("");
      void qc.invalidateQueries({ queryKey: ["vaccines", ownerAccountId] });
      setMsg("Vaccine saved. Confirm the schedule with your vet.");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "create the vaccine"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: space.md }}>
      <Text style={styles.title}>Vaccine catalogue</Text>
      <Text style={styles.sub}>Define vaccines once, then build flock plans from Tasks.</Text>

      <View style={[styles.hero, shadow.card]}>
        <Image source={{ uri: media.vaccineCare }} style={styles.heroImg} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Keep every hen protected</Text>
          <Text style={styles.heroBody}>Clear schedules beat missed doses.</Text>
        </View>
      </View>

      {canManage ? (
        <View style={[styles.form, shadow.card]}>
          <Text style={styles.formTitle}>Add a vaccine</Text>
          <Text style={styles.label}>Vaccine name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Newcastle (Lasota)"
            placeholderTextColor={colors.inkMuted}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>Give at hen age (days)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 7"
            placeholderTextColor={colors.inkMuted}
            value={ageDays}
            onChangeText={setAgeDays}
            keyboardType="number-pad"
          />
          <Text style={styles.note}>We’ll remind 3 days before. Always confirm with your vet.</Text>
          <Button label="Add vaccine" onPress={onCreate} loading={busy} disabled={!name.trim()} />
          {msg ? <Text style={styles.meta}>{msg}</Text> : null}
        </View>
      ) : null}

      <Text style={styles.section}>Your vaccines{vaccines.data ? ` (${vaccines.data.length})` : ""}</Text>
      <FlatList
        style={{ flex: 1 }}
        data={vaccines.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          vaccines.isLoading ? (
            <HenLoader label="Loading vaccines…" />
          ) : (
            <EmptyState
              title="No vaccines yet"
              body="Add Newcastle, IBD, or your farm’s custom vaccines to start planning."
              imageUri={media.vaccineCare}
            />
          )
        }
        renderItem={({ item }) => (
          <MediaCard
            title={item.name}
            subtitle={item.category || "Vaccine"}
            meta={item.is_active ? "Active in catalogue" : "Archived"}
            imageUri={media.vaccineCare}
            icon="medkit"
            badge={item.is_active ? "Active" : "Off"}
            badgeTone={item.is_active ? "good" : "neutral"}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  sub: { color: colors.inkMuted, fontSize: 14, marginTop: -space.sm },
  hero: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  heroImg: { width: "100%", height: 120 },
  heroCopy: { padding: space.md, gap: 4 },
  heroTitle: { fontWeight: "800", color: colors.ink, fontSize: 16 },
  heroBody: { color: colors.inkMuted, fontSize: 13 },
  form: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
  },
  formTitle: { fontSize: 17, fontWeight: "800", color: colors.ink, marginBottom: space.xs },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  note: { color: colors.inkMuted, fontSize: 13, marginBottom: space.sm },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    color: colors.ink,
    fontSize: 16,
  },
  meta: { color: colors.inkMuted, fontSize: 13 },
});
