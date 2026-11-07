import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  filterShedOptions,
  type ShedFilterOption,
} from "../../features/sheds/shedFilterHelpers";
import { typography } from "../../theme/tokens";
import { FormBottomSheet } from "../ui/FormBottomSheet";

const ui = {
  ink: "#15342C",
  muted: "#71837C",
  mutedSoft: "#8A9A93",
  brand: "#07835D",
  brandSoft: "#E3F5EE",
  searchBg: "#EEF4F1",
  track: "#D5DED9",
  thumb: "#9AA8A1",
  empty: "#8A9A93",
};

type Props = {
  visible: boolean;
  onClose: () => void;
  options: ShedFilterOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  title?: string;
};

type ScrollMetrics = {
  offset: number;
  content: number;
  viewport: number;
};

/**
 * Shared shed picker: search, All sheds, selected mint row + check, thin scroll thumb.
 */
export function ShedFilterSheet({
  visible,
  onClose,
  options,
  selectedId,
  onSelect,
  title = "Filter by shed",
}: Props) {
  const [query, setQuery] = useState("");
  const [listHeight, setListHeight] = useState(0);
  const [scroll, setScroll] = useState<ScrollMetrics>({ offset: 0, content: 1, viewport: 1 });

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setScroll({ offset: 0, content: 1, viewport: 1 });
  }, [visible]);

  const filtered = useMemo(() => filterShedOptions(options, query), [options, query]);
  const empty = filtered.length === 0;
  const overflow = scroll.content > scroll.viewport + 2;
  const trackH = Math.max(0, listHeight - 16);
  const thumbH = overflow
    ? Math.max(18, (scroll.viewport / Math.max(scroll.content, 1)) * trackH)
    : 0;
  const maxOffset = Math.max(1, scroll.content - scroll.viewport);
  const thumbTop = overflow
    ? Math.min(Math.max(0, (scroll.offset / maxOffset) * (trackH - thumbH)), Math.max(0, trackH - thumbH))
    : 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setScroll({
      offset: Math.max(0, contentOffset.y),
      content: Math.max(1, contentSize.height),
      viewport: Math.max(1, layoutMeasurement.height),
    });
  };

  const pick = (id: string) => {
    Keyboard.dismiss();
    onSelect(id);
    onClose();
  };

  return (
    <FormBottomSheet
      visible={visible}
      onClose={onClose}
      dismissAccessibilityLabel="Dismiss shed filter"
      maxHeightFraction={0.72}
      sheetStyle={styles.sheet}
      header={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={ui.mutedSoft} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search sheds"
              placeholderTextColor={ui.mutedSoft}
              style={styles.search}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search sheds"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={ui.mutedSoft} />
              </Pressable>
            ) : null}
          </View>
        </View>
      }
      body={
        empty ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No matching sheds</Text>
            <Text style={styles.emptyBody}>Try a different name, or clear the search.</Text>
          </View>
        ) : (
          <View
            style={styles.listWrap}
            onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
          >
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              onScroll={onScroll}
              scrollEventThrottle={16}
              style={styles.list}
              renderItem={({ item }) => {
                const active = item.id === selectedId;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${item.label}${active ? ", selected" : ""}`}
                    onPress={() => pick(item.id)}
                    style={[styles.row, active && styles.rowActive]}
                  >
                    <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={20} color={ui.brand} /> : null}
                  </Pressable>
                );
              }}
            />
            {overflow ? (
              <View style={styles.track} pointerEvents="none">
                <View style={[styles.thumb, { height: thumbH, transform: [{ translateY: thumbTop }] }]} />
              </View>
            ) : null}
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 20,
  },
  header: {
    gap: 14,
    paddingBottom: 4,
  },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: ui.ink,
    letterSpacing: -0.4,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ui.searchBg,
    borderRadius: 22,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  search: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: ui.ink,
    paddingVertical: 10,
    includeFontPadding: false,
  },
  listWrap: {
    height: 320,
    position: "relative",
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    paddingRight: 18,
    borderRadius: 14,
    minHeight: 52,
  },
  rowActive: {
    backgroundColor: ui.brandSoft,
  },
  rowText: {
    flex: 1,
    fontSize: typography.bodyStrong.fontSize,
    fontWeight: "600",
    color: ui.ink,
    paddingRight: 8,
  },
  rowTextActive: {
    fontWeight: "800",
    color: ui.ink,
  },
  track: {
    position: "absolute",
    right: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: ui.track,
    overflow: "hidden",
  },
  thumb: {
    width: 3,
    borderRadius: 2,
    backgroundColor: ui.thumb,
  },
  emptyWrap: {
    paddingVertical: 28,
    paddingHorizontal: 12,
    gap: 6,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: typography.bodyStrong.fontSize,
    fontWeight: "800",
    color: ui.ink,
  },
  emptyBody: {
    fontSize: typography.secondary.fontSize,
    fontWeight: "500",
    color: ui.empty,
    textAlign: "center",
  },
});
