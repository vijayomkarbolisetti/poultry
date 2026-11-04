import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, space, typography } from "../../theme/tokens";
import {
  clampIsoDate,
  formatDisplayDate,
  formatIsoDate,
  parseIsoDate,
  todayIsoDate,
} from "./selectUtils";

export type AppDatePickerProps = {
  label: string;
  /** Controlled value as YYYY-MM-DD (API / storage format). */
  value: string | null;
  onChange: (value: string | null) => void;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  /** Inclusive minimum YYYY-MM-DD. */
  minimumDate?: string | null;
  /** Inclusive maximum YYYY-MM-DD. */
  maximumDate?: string | null;
  /** Show human-readable label (default). Pass false to show raw YYYY-MM-DD. */
  humanReadable?: boolean;
  testID?: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type CalendarView = "days" | "months" | "years";

const DEFAULT_YEAR_PAD = 40;

function draftFromValue(
  value: string | null | undefined,
  minimumDate?: string | null,
  maximumDate?: string | null,
): Date {
  const base = parseIsoDate(value ?? "") ?? new Date();
  const iso = clampIsoDate(formatIsoDate(base), minimumDate, maximumDate);
  return parseIsoDate(iso) ?? base;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function monthTitle(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function buildMonthCells(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const startPad = first.getDay(); // 0 = Sunday
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function yearBounds(
  minimumDate?: string | null,
  maximumDate?: string | null,
  anchorYear?: number,
): { minYear: number; maxYear: number } {
  const nowYear = new Date().getFullYear();
  const center = anchorYear ?? nowYear;
  let minYear = center - DEFAULT_YEAR_PAD;
  let maxYear = center + DEFAULT_YEAR_PAD;
  if (minimumDate) {
    const y = Number(minimumDate.slice(0, 4));
    if (!Number.isNaN(y)) minYear = y;
  }
  if (maximumDate) {
    const y = Number(maximumDate.slice(0, 4));
    if (!Number.isNaN(y)) maxYear = y;
  }
  if (minYear > maxYear) {
    return { minYear: center, maxYear: center };
  }
  return { minYear, maxYear };
}

function isYearDisabled(
  year: number,
  minimumDate?: string | null,
  maximumDate?: string | null,
): boolean {
  if (minimumDate) {
    const maxMonth = 11;
    const maxDay = new Date(year, maxMonth + 1, 0).getDate();
    const last = formatIsoDate(new Date(year, maxMonth, maxDay));
    if (last < minimumDate) return true;
  }
  if (maximumDate) {
    const first = formatIsoDate(new Date(year, 0, 1));
    if (first > maximumDate) return true;
  }
  return false;
}

function isMonthDisabled(
  year: number,
  monthIndex: number,
  minimumDate?: string | null,
  maximumDate?: string | null,
): boolean {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const firstIso = formatIsoDate(new Date(year, monthIndex, 1));
  const lastIso = formatIsoDate(new Date(year, monthIndex, lastDay));
  if (minimumDate && lastIso < minimumDate) return true;
  if (maximumDate && firstIso > maximumDate) return true;
  return false;
}

/**
 * App-wide date-only picker with a PoultryTrack-themed calendar sheet
 * (mint/forest accents) on Android and iOS. Values stay YYYY-MM-DD local.
 * Tap the month title to jump by year, then month.
 */
export function AppDatePicker({
  label,
  value,
  onChange,
  helper,
  error,
  required,
  disabled,
  placeholder = "Select date",
  clearable,
  minimumDate,
  maximumDate,
  humanReadable = true,
  testID,
}: AppDatePickerProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalendarView>("days");
  const [draft, setDraft] = useState<Date>(() => draftFromValue(value, minimumDate, maximumDate));
  const [visibleMonth, setVisibleMonth] = useState<Date>(() =>
    startOfMonth(draftFromValue(value, minimumDate, maximumDate)),
  );

  const todayIso = todayIsoDate();
  const todayDt = useMemo(() => parseIsoDate(todayIso) ?? new Date(), [todayIso]);

  useEffect(() => {
    if (!open) return;
    const next = draftFromValue(value, minimumDate, maximumDate);
    setDraft(next);
    setVisibleMonth(startOfMonth(next));
    setView("days");
  }, [open, value, minimumDate, maximumDate]);

  const display = value
    ? humanReadable
      ? formatDisplayDate(value)
      : value
    : placeholder;

  const cells = useMemo(() => buildMonthCells(visibleMonth), [visibleMonth]);

  const years = useMemo(() => {
    const { minYear, maxYear } = yearBounds(
      minimumDate,
      maximumDate,
      visibleMonth.getFullYear(),
    );
    const list: number[] = [];
    for (let y = minYear; y <= maxYear; y++) list.push(y);
    return list;
  }, [minimumDate, maximumDate, visibleMonth]);

  const canGoPrev = useMemo(() => {
    if (!minimumDate) return true;
    const prevLast = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 0);
    return formatIsoDate(prevLast) >= minimumDate;
  }, [visibleMonth, minimumDate]);

  const canGoNext = useMemo(() => {
    if (!maximumDate) return true;
    const nextFirst = addMonths(visibleMonth, 1);
    return formatIsoDate(nextFirst) <= maximumDate;
  }, [visibleMonth, maximumDate]);

  const openPicker = () => {
    if (disabled) return;
    Keyboard.dismiss();
    const next = draftFromValue(value, minimumDate, maximumDate);
    setDraft(next);
    setVisibleMonth(startOfMonth(next));
    setView("days");
    setOpen(true);
  };

  const closePicker = () => {
    setOpen(false);
    setView("days");
  };

  const isDisabledDay = (d: Date) => {
    const iso = formatIsoDate(d);
    if (minimumDate && iso < minimumDate) return true;
    if (maximumDate && iso > maximumDate) return true;
    return false;
  };

  const confirm = () => {
    onChange(clampIsoDate(formatIsoDate(draft), minimumDate, maximumDate));
    setOpen(false);
    setView("days");
  };

  const useToday = () => {
    const iso = clampIsoDate(todayIsoDate(), minimumDate, maximumDate);
    const dt = parseIsoDate(iso);
    if (!dt) return;
    setDraft(dt);
    setVisibleMonth(startOfMonth(dt));
    setView("days");
  };

  const selectYear = (year: number) => {
    if (isYearDisabled(year, minimumDate, maximumDate)) return;
    const next = new Date(year, visibleMonth.getMonth(), 1);
    setVisibleMonth(next);
    setView("months");
  };

  const selectMonth = (monthIndex: number) => {
    const year = visibleMonth.getFullYear();
    if (isMonthDisabled(year, monthIndex, minimumDate, maximumDate)) return;
    const next = new Date(year, monthIndex, 1);
    setVisibleMonth(next);
    // Keep draft day if possible within the new month
    const maxDay = new Date(year, monthIndex + 1, 0).getDate();
    const day = Math.min(draft.getDate(), maxDay);
    const candidate = new Date(year, monthIndex, day);
    if (!isDisabledDay(candidate)) {
      setDraft(candidate);
    } else {
      // Snap to nearest allowed day in month
      for (let d = 1; d <= maxDay; d++) {
        const tryDay = new Date(year, monthIndex, d);
        if (!isDisabledDay(tryDay)) {
          setDraft(tryDay);
          break;
        }
      }
    }
    setView("days");
  };

  const navTitle =
    view === "years"
      ? "Select year"
      : view === "months"
        ? String(visibleMonth.getFullYear())
        : monthTitle(visibleMonth);

  const onNavTitlePress = () => {
    if (view === "days") setView("years");
    else if (view === "months") setView("years");
    else setView("days");
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `, ${display}` : ", no date selected"}`}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.field,
          error ? styles.fieldError : null,
          disabled ? styles.fieldDisabled : null,
          pressed && !disabled ? { opacity: 0.9 } : null,
        ]}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.inkMuted} />
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {display}
        </Text>
        {clearable && value && !disabled && !required ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={10}
            onPress={() => onChange(null)}
          >
            <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={closePicker}>
        <Pressable style={styles.scrim} onPress={closePicker} accessibilityLabel="Dismiss date picker">
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Pressable onPress={closePicker} hitSlop={12} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {label.replace(/\s*\*$/, "")}
              </Text>
              <Pressable onPress={confirm} hitSlop={12} accessibilityRole="button">
                <Text style={styles.confirmText}>Confirm</Text>
              </Pressable>
            </View>

            <View style={styles.monthNav}>
              {view === "days" ? (
                <Pressable
                  onPress={() => canGoPrev && setVisibleMonth((m) => addMonths(m, -1))}
                  disabled={!canGoPrev}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                  style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}
                >
                  <Ionicons
                    name="chevron-back"
                    size={20}
                    color={canGoPrev ? colors.brand : colors.inkMuted}
                  />
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setView(view === "years" ? "days" : "years")}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  style={styles.navBtn}
                >
                  <Ionicons name="chevron-back" size={20} color={colors.brand} />
                </Pressable>
              )}

              <Pressable
                onPress={onNavTitlePress}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  view === "days"
                    ? "Jump to year"
                    : view === "months"
                      ? "Change year"
                      : "Back to calendar"
                }
                style={styles.monthTitleBtn}
              >
                <Text style={styles.monthTitle}>{navTitle}</Text>
                {view !== "years" ? (
                  <Ionicons name="caret-down" size={14} color={colors.brand} />
                ) : null}
              </Pressable>

              {view === "days" ? (
                <Pressable
                  onPress={() => canGoNext && setVisibleMonth((m) => addMonths(m, 1))}
                  disabled={!canGoNext}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                  style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={canGoNext ? colors.brand : colors.inkMuted}
                  />
                </Pressable>
              ) : (
                <View style={styles.navBtnSpacer} />
              )}
            </View>

            {view === "days" ? (
              <>
                <View style={styles.weekRow}>
                  {WEEKDAYS.map((d) => (
                    <Text key={d} style={styles.weekday}>
                      {d}
                    </Text>
                  ))}
                </View>

                <View style={styles.grid}>
                  {cells.map((cell, index) => {
                    if (!cell) {
                      return <View key={`e-${index}`} style={styles.dayCell} />;
                    }
                    const iso = formatIsoDate(cell);
                    const selected = isSameDay(cell, draft);
                    const isToday = isSameDay(cell, todayDt);
                    const dayDisabled = isDisabledDay(cell);
                    return (
                      <Pressable
                        key={iso}
                        disabled={dayDisabled}
                        onPress={() => setDraft(cell)}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: dayDisabled }}
                        accessibilityLabel={formatDisplayDate(iso)}
                        style={[
                          styles.dayCell,
                          selected && styles.daySelected,
                          !selected && isToday && styles.dayToday,
                          dayDisabled && styles.dayDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            selected && styles.dayTextSelected,
                            !selected && isToday && styles.dayTextToday,
                            dayDisabled && styles.dayTextDisabled,
                          ]}
                        >
                          {cell.getDate()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {view === "months" ? (
              <View style={styles.pickerGrid}>
                {MONTH_SHORT.map((name, monthIndex) => {
                  const year = visibleMonth.getFullYear();
                  const selected =
                    draft.getFullYear() === year && draft.getMonth() === monthIndex;
                  const monthDisabled = isMonthDisabled(
                    year,
                    monthIndex,
                    minimumDate,
                    maximumDate,
                  );
                  const isCurrent =
                    todayDt.getFullYear() === year && todayDt.getMonth() === monthIndex;
                  return (
                    <Pressable
                      key={name}
                      disabled={monthDisabled}
                      onPress={() => selectMonth(monthIndex)}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: monthDisabled }}
                      accessibilityLabel={`${name} ${year}`}
                      style={[
                        styles.pickerCell,
                        selected && styles.daySelected,
                        !selected && isCurrent && styles.dayToday,
                        monthDisabled && styles.dayDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pickerCellText,
                          selected && styles.dayTextSelected,
                          !selected && isCurrent && styles.dayTextToday,
                          monthDisabled && styles.dayTextDisabled,
                        ]}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {view === "years" ? (
              <ScrollView
                style={styles.yearScroll}
                contentContainerStyle={styles.pickerGrid}
                showsVerticalScrollIndicator={false}
              >
                {years.map((year) => {
                  const selected = visibleMonth.getFullYear() === year;
                  const yearDisabled = isYearDisabled(year, minimumDate, maximumDate);
                  const isCurrent = todayDt.getFullYear() === year;
                  return (
                    <Pressable
                      key={year}
                      disabled={yearDisabled}
                      onPress={() => selectYear(year)}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: yearDisabled }}
                      accessibilityLabel={`Year ${year}`}
                      style={[
                        styles.pickerCell,
                        selected && styles.daySelected,
                        !selected && isCurrent && styles.dayToday,
                        yearDisabled && styles.dayDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pickerCellText,
                          selected && styles.dayTextSelected,
                          !selected && isCurrent && styles.dayTextToday,
                          yearDisabled && styles.dayTextDisabled,
                        ]}
                      >
                        {year}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {view === "days" ? (
              <Pressable onPress={useToday} style={styles.todayBtn} accessibilityRole="button">
                <Text style={styles.todayText}>Use today</Text>
              </Pressable>
            ) : (
              <Text style={styles.jumpHint}>
                {view === "years" ? "Pick a year, then a month" : "Pick a month"}
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: colors.ink, fontSize: typography.label.fontSize, fontWeight: "700" },
  required: { color: colors.danger },
  helper: { color: colors.inkMuted, fontSize: typography.caption.fontSize, marginTop: -2 },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { opacity: 0.55 },
  value: { flex: 1, fontSize: typography.bodyStrong.fontSize, color: colors.ink, fontWeight: "600" },
  placeholder: { color: colors.inkMuted, fontWeight: "500" },
  error: { color: colors.danger, fontSize: typography.secondary.fontSize },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(2, 44, 34, 0.42)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: space.md,
    gap: 8,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sheetTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: colors.ink,
    marginHorizontal: 8,
  },
  cancelText: { color: colors.inkMuted, fontWeight: "700", fontSize: typography.bodyStrong.fontSize },
  confirmText: { color: colors.brand, fontWeight: "800", fontSize: typography.bodyStrong.fontSize },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  navBtnDisabled: { backgroundColor: colors.bg, opacity: 0.6 },
  navBtnSpacer: { width: 40, height: 40 },
  monthTitleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  monthTitle: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: colors.ink,
  },
  weekRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: colors.inkMuted,
    paddingVertical: 6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  daySelected: {
    backgroundColor: colors.brand,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.brand,
  },
  dayDisabled: {
    opacity: 0.35,
  },
  dayText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.ink,
  },
  dayTextSelected: {
    color: colors.textOnPrimary,
    fontWeight: "800",
  },
  dayTextToday: {
    color: colors.brand,
    fontWeight: "800",
  },
  dayTextDisabled: {
    color: colors.inkMuted,
  },
  pickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingVertical: 8,
    gap: 8,
    justifyContent: "space-between",
  },
  pickerCell: {
    width: "30%",
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  pickerCellText: {
    fontSize: typography.bodyStrong.fontSize,
    fontWeight: "700",
    color: colors.ink,
  },
  yearScroll: {
    maxHeight: 280,
  },
  todayBtn: {
    alignItems: "center",
    paddingVertical: 12,
    marginBottom: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
  },
  todayText: { color: colors.brand, fontWeight: "800", fontSize: typography.bodyStrong.fontSize },
  jumpHint: {
    textAlign: "center",
    color: colors.inkMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    paddingVertical: 10,
  },
});
