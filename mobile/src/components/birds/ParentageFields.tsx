import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { type BirdParentInput } from "../../api/birds";
import { birdUi } from "../../theme/birdManagementUi";

export type ParentDraft = {
  /** Preserved when loaded from a linked farm bird; cleared if the user edits fields. */
  birdId: string | null;
  displayName: string;
  bandNumber: string;
};

export const EMPTY_PARENT: ParentDraft = {
  birdId: null,
  displayName: "",
  bandNumber: "",
};

type Role = "sire" | "dam";

type Props = {
  role: Role;
  value: ParentDraft;
  onChange: (next: ParentDraft) => void;
  /** Kept for call-site compatibility; unused after selector removal. */
  excludeBirdId?: string | null;
};

export function parentDraftToInput(draft: ParentDraft): BirdParentInput {
  const name = draft.displayName.trim();
  const band = draft.bandNumber.trim();

  // Preserve a linked farm parent until the user edits name/band (which clears birdId).
  if (draft.birdId) {
    return { mode: "existing", bird_id: draft.birdId };
  }

  if (!name && !band) return { mode: "unknown" };

  return {
    mode: "manual",
    display_name: name || null,
    band_number: band || null,
    breed: null,
    notes: null,
  };
}

export function ParentageFields({ role, value, onChange }: Props) {
  const title = role === "sire" ? "Sire (Father)" : "Dam (Mother)";
  const namePlaceholder = role === "sire" ? "Enter sire name" : "Enter dam name";
  const bandPlaceholder =
    role === "sire" ? "Enter sire wing band number" : "Enter dam wing band number";
  const [open, setOpen] = useState(false);

  const setName = (t: string) => onChange({ ...value, birdId: null, displayName: t });
  const setBand = (t: string) => onChange({ ...value, birdId: null, bandNumber: t });

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.title}>{title}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={birdUi.muted} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <Text style={styles.label}>Name (Optional)</Text>
          <TextInput
            style={styles.input}
            value={value.displayName}
            onChangeText={setName}
            placeholder={namePlaceholder}
            placeholderTextColor={birdUi.muted}
            accessibilityLabel={`${title} name`}
          />
          <Text style={styles.label}>Wing Band Number (Optional)</Text>
          <TextInput
            style={styles.input}
            value={value.bandNumber}
            onChangeText={setBand}
            placeholder={bandPlaceholder}
            placeholderTextColor={birdUi.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel={`${title} wing band number`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    backgroundColor: birdUi.white,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: { fontSize: 15, fontWeight: "800", color: birdUi.text },
  body: { paddingHorizontal: 14, paddingBottom: 12, gap: 6 },
  label: { fontSize: 13, fontWeight: "700", color: birdUi.muted, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: birdUi.white,
    color: birdUi.text,
    fontSize: 16,
    fontWeight: "600",
    minHeight: 48,
  },
});
