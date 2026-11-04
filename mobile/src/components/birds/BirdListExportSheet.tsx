import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  downloadBirdListExport,
  exportPeriodRange,
  isFileSaveCancelled,
  type BirdListExportFormat,
  type BirdListExportKind,
} from "../../features/birds/birdListExport";
import { birdUi } from "../../theme/birdManagementUi";
import { typography } from "../../theme/tokens";
import { toast } from "../../ui/toast/toastStore";
import { AppDatePicker } from "../ui/AppDatePicker";
import { Button } from "../ui/Button";
import { FormBottomSheet } from "../ui/FormBottomSheet";
import { todayIsoDate } from "../ui/selectUtils";

type RangePreset = "last_month" | "last_3_months" | "custom";

type Props = {
  visible: boolean;
  kind: BirdListExportKind;
  onClose: () => void;
};

function titleFor(kind: BirdListExportKind): string {
  return kind === "dead" ? "Download dead birds" : "Download sold birds";
}

export function BirdListExportSheet({ visible, kind, onClose }: Props) {
  const [preset, setPreset] = useState<RangePreset>("last_month");
  const [format, setFormat] = useState<BirdListExportFormat>("xlsx");
  const [customFrom, setCustomFrom] = useState(() => todayIsoDate());
  const [customTo, setCustomTo] = useState(() => todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setPreset("last_month");
    setFormat("xlsx");
    setCustomFrom(todayIsoDate());
    setCustomTo(todayIsoDate());
    setBusy(false);
    setError(null);
    lock.current = false;
  }, [visible]);

  const resolveRange = (): { from: string; to: string } | null => {
    if (preset === "custom") {
      if (!customFrom || !customTo) {
        setError("Choose both start and end dates.");
        return null;
      }
      if (customFrom > customTo) {
        setError("Start date must be on or before the end date.");
        return null;
      }
      return { from: customFrom, to: customTo };
    }
    return exportPeriodRange(preset);
  };

  const onDownload = () => {
    if (busy || lock.current) return;
    const range = resolveRange();
    if (!range) return;

    lock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await downloadBirdListExport({ kind, format, range });
        onClose();
        toast.success(`Saved ${result.filename} to selected folder`);
      } catch (e: unknown) {
        if (isFileSaveCancelled(e)) {
          toast.info("Save cancelled — file was not written.");
          return;
        }
        const msg = e instanceof Error ? e.message : "Could not download export.";
        setError(msg);
        toast.error(msg, 8_000);
      } finally {
        setBusy(false);
        lock.current = false;
      }
    })();
  };

  return (
    <FormBottomSheet
      visible={visible}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnScrimPress={!busy}
      dismissAccessibilityLabel="Close download options"
      header={
        <View style={styles.header}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>{titleFor(kind)}</Text>
            <Pressable
              onPress={() => {
                if (!busy) onClose();
              }}
              disabled={busy}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.closeBtn, busy && { opacity: 0.45 }]}
            >
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>
          <Text style={styles.sub}>Choose a date range and file format</Text>
        </View>
      }
      footer={
        <View style={styles.footerPad}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Download" onPress={onDownload} loading={busy} disabled={busy} />
        </View>
      }
      contentContainerStyle={styles.body}
    >
      <Text style={styles.sectionLabel}>Date range</Text>
      <View style={styles.chips}>
        {(
          [
            ["last_month", "Last Month"],
            ["last_3_months", "Last 3 Months"],
            ["custom", "Custom Range"],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => {
              if (!busy) {
                setPreset(key);
                setError(null);
              }
            }}
            style={[styles.chip, preset === key && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: preset === key }}
            disabled={busy}
          >
            <Text style={[styles.chipText, preset === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {preset === "custom" ? (
        <View style={styles.customDates}>
          <AppDatePicker
            label="Start date"
            value={customFrom}
            onChange={(v) => {
              setCustomFrom(v ?? todayIsoDate());
              setError(null);
            }}
            maximumDate={customTo}
            disabled={busy}
          />
          <AppDatePicker
            label="End date"
            value={customTo}
            onChange={(v) => {
              setCustomTo(v ?? todayIsoDate());
              setError(null);
            }}
            minimumDate={customFrom}
            maximumDate={todayIsoDate()}
            disabled={busy}
          />
        </View>
      ) : null}

      <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Format</Text>
      <View style={styles.chips}>
        {(
          [
            ["xlsx", "Excel (.xlsx)"],
            ["csv", "CSV (.csv)"],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => {
              if (!busy) setFormat(key);
            }}
            style={[styles.chip, format === key && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: format === key }}
            disabled={busy}
          >
            <Text style={[styles.chipText, format === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </FormBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, gap: 6 },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: birdUi.border,
    marginBottom: 4,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.text,
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: birdUi.bg,
  },
  sub: { fontSize: typography.label.fontSize, color: birdUi.muted, marginBottom: 4 },
  body: { paddingHorizontal: 18, gap: 10 },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: birdUi.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: birdUi.bg,
    borderWidth: 1,
    borderColor: birdUi.border,
  },
  chipOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  chipText: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.text },
  chipTextOn: { color: "#fff" },
  customDates: { gap: 10, marginTop: 4 },
  footerPad: { paddingHorizontal: 18, gap: 8 },
  error: { color: birdUi.error, fontWeight: "600", fontSize: typography.caption.fontSize },
});
