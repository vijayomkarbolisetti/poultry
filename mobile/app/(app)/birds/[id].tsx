import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  getBirdProfile,
  type BirdParentage,
  type BirdProfileLifecycle,
  type BirdProfileVaccinationEvent,
} from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { recordLifecycle } from "../../../src/api/flocks";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { Button } from "../../../src/components/ui/Button";
import { DataQualityBanner } from "../../../src/components/ui/DataQualityBanner";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { formatDisplayDate, todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  formatLifecycleLabel,
  formatRelativeAgeLabel,
  formatSexLabel,
} from "../../../src/features/birds/birdListHelpers";
import {
  downloadBirdReportPdf,
  shareBirdReport,
} from "../../../src/features/birds/birdReportDownload";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { shedHeaderArt } from "../../../src/theme/media";
import { toast } from "../../../src/ui/toast/toastStore";

export default function BirdProfileScreen() {
  const { id, fromShedId } = useLocalSearchParams<{ id: string; fromShedId?: string }>();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const canUpdate = hasPermission(user, ownerAccountId, "bird.update");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");
  const [lifeBusy, setLifeBusy] = useState(false);
  const [lifeMsg, setLifeMsg] = useState<string | null>(null);
  const [mortalityOpen, setMortalityOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDialog, setReportDialog] = useState<{
    uri: string;
    filename: string;
  } | null>(null);
  const lifeLock = useRef(false);
  const reportLock = useRef(false);
  const lifeIdemKey = useRef<string | null>(null);

  const profile = useQuery({
    queryKey: ["bird-profile", id],
    queryFn: () => getBirdProfile(id!),
    enabled: !!id && canView,
  });

  useFocusEffect(
    useCallback(() => {
      if (!id || !canView) return;
      void profile.refetch();
    }, [id, canView]),
  );

  const backTarget = fromShedId ? `/(app)/sheds/${fromShedId}/birds` : "/(app)/search";

  const invalidateRelated = (shedId?: string, flockId?: string) => {
    void qc.invalidateQueries({ queryKey: ["bird-profile", id] });
    void qc.invalidateQueries({ queryKey: ["shed-birds"] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
    void qc.invalidateQueries({ queryKey: ["birds", flockId] });
    void qc.invalidateQueries({ queryKey: ["flock", flockId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
  };

  const onMortality = () => {
    if (!id || !profile.data || lifeLock.current || !profile.data.is_active) return;
    setMortalityOpen(true);
  };

  const confirmMortality = async () => {
    if (!id || !profile.data || lifeLock.current) return;
    lifeLock.current = true;
    setLifeBusy(true);
    setLifeMsg(null);
    if (!lifeIdemKey.current) {
      lifeIdemKey.current = newLifecycleIdempotencyKey(`mortality-${id}`);
    }
    try {
      await recordLifecycle({
        event_type: "mortality",
        effective_date: todayIsoDate(),
        bird_id: id,
        quantity: 1,
        reason: "Recorded from bird profile (mortality)",
        idempotency_key: lifeIdemKey.current,
      });
      invalidateRelated(profile.data.shed_id, profile.data.flock_id);
      setMortalityOpen(false);
      lifeIdemKey.current = null;
      toast.success("Mortality recorded");
      await profile.refetch();
    } catch (e: unknown) {
      setMortalityOpen(false);
      setLifeMsg(describeApiError(e, "record mortality"));
    } finally {
      setLifeBusy(false);
      lifeLock.current = false;
    }
  };

  const onDownloadReport = async () => {
    if (!id || !profile.data || reportLock.current) return;
    reportLock.current = true;
    setReportBusy(true);
    try {
      const result = await downloadBirdReportPdf({
        birdId: id,
        bandOrCode: profile.data.band_id ?? profile.data.display_code,
      });
      setReportDialog({ uri: result.uri, filename: result.filename });
      toast.success("Report downloaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : describeApiError(e, "download bird report");
      toast.error(msg);
    } finally {
      setReportBusy(false);
      reportLock.current = false;
    }
  };

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view bird profiles.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(backTarget)} />
      </Screen>
    );
  }

  if (profile.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading bird…" />
      </Screen>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(profile.error, "load bird profile")}</Text>
        <Button label="Retry" onPress={() => profile.refetch()} />
      </Screen>
    );
  }

  const p = profile.data;
  const title = p.band_id ?? p.display_code ?? p.id.slice(0, 8);
  const nameLine =
    p.display_code && p.band_id && p.display_code !== p.band_id ? p.display_code : null;
  const ageLabel =
    p.hatch_date != null
      ? `${formatDisplayDate(p.hatch_date)} · ${formatRelativeAgeLabel({
          hatch_date: p.hatch_date,
          estimated_age_days: p.estimated_age_days,
        })}`
      : p.estimated_age_days != null
        ? `~ ${p.estimated_age_days} days`
        : p.dob_confidence === "unknown"
          ? "Unknown"
          : formatLifecycleLabel(p.dob_confidence);
  const addedOn = p.created_at ? formatDisplayDate(p.created_at.slice(0, 10)) : "—";
  const vaccinations = [...(p.individual_vaccinations ?? [])].sort((a, b) =>
    a.administration_date < b.administration_date ? -1 : 1,
  );
  const lifecycle = [...(p.lifecycle_events ?? [])].sort((a, b) =>
    a.effective_date < b.effective_date ? -1 : 1,
  );
  const statusKey = (p.lifecycle_status || "").toLowerCase();
  const statusTone =
    statusKey === "active" ? "active" : statusKey === "dead" ? "dead" : "inactive";

  return (
    <Screen scroll edges={["left", "right", "bottom"]} style={{ backgroundColor: birdUi.bg, gap: 12 }}>
      <View style={styles.topBar}>
        <Pressable onPress={() => safeBack(backTarget)} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <Text style={styles.screenTitle}>Bird Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <Pressable
        onPress={() => void onDownloadReport()}
        disabled={reportBusy}
        style={[styles.downloadBtn, reportBusy && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Download report"
      >
        <Ionicons name="download-outline" size={18} color={birdUi.primary} />
        <Text style={styles.downloadBtnText}>{reportBusy ? "Preparing…" : "Download report"}</Text>
      </Pressable>
      <Text style={styles.downloadHint}>
        Export includes bird details, sale details, parentage, lifecycle history, and all vaccination
        records.
      </Text>

      <View style={styles.summaryCard}>
        <Image source={shedHeaderArt} style={styles.summaryArt} resizeMode="cover" />
        <View style={styles.summaryOverlay}>
          <View style={styles.summaryPhoto}>
            <Ionicons name="egg-outline" size={32} color={birdUi.primary} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.summaryBand} selectable>
              {title}
            </Text>
            {nameLine ? <Text style={styles.summaryName}>{nameLine}</Text> : null}
            <View style={styles.summaryStatusRow}>
              <Ionicons name="egg" size={14} color={birdUi.primary} />
              <View
                style={[
                  styles.statusBadge,
                  statusTone === "active" && styles.statusActive,
                  statusTone === "dead" && styles.statusDead,
                  statusTone === "inactive" && styles.statusInactive,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    statusTone === "active" && { color: birdUi.successText },
                    statusTone === "dead" && { color: birdUi.error },
                    statusTone === "inactive" && { color: birdUi.orange },
                  ]}
                >
                  {formatLifecycleLabel(p.lifecycle_status)}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {!p.is_active ? (
        <DataQualityBanner
          message={
            statusKey === "sold"
              ? "This bird is not active (Sold). Historical vaccinations are preserved; new vaccinations cannot be recorded."
              : `This bird is not active (${formatLifecycleLabel(p.lifecycle_status)}).`
          }
        />
      ) : null}

      {p.lifecycle_status === "sold" && p.sale ? (
        <SectionCard
          icon="pricetag-outline"
          iconColor={birdUi.orange}
          iconBg={birdUi.orangePale}
          title="Sale details"
        >
          <View style={styles.saleGrid}>
            <SaleCell
              icon="calendar-outline"
              label="Sold on"
              value={formatDisplayDate(p.sale.sold_on)}
            />
            <SaleCell
              icon="person-outline"
              label="Buyer"
              value={p.sale.buyer_name?.trim() || "—"}
            />
            <SaleCell
              icon="call-outline"
              label="Mobile"
              value={p.sale.buyer_mobile?.trim() || "—"}
            />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard icon="paw-outline" title="Bird details">
        <DetailRow label="Band number" value={p.band_id?.trim() || "—"} />
        <DetailRow label="Bird name / code" value={p.display_code?.trim() || "—"} />
        <DetailRow label="Farm" value={p.organization_name?.trim() || "—"} />
        <DetailRow label="Shed" value={`${p.shed_name ?? "—"} (${p.shed_code ?? "—"})`} />
        <DetailRow label="Batch / cohort" value={p.batch_code?.trim() || "—"} />
        <DetailRow label="Hatch date / age" value={ageLabel} />
        <DetailRow label="Breed" value={p.breed?.trim() || "—"} />
        <DetailRow label="Sex" value={formatSexLabel(p.sex)} />
        <DetailRow label="Added on" value={addedOn} />
        <DetailRow label="Notes" value={p.notes?.trim() || "—"} last />
      </SectionCard>

      <SectionCard icon="people-outline" title="Parentage">
        <View style={styles.parentRow}>
          <ParentCard
            role="Sire (Father)"
            genderIcon="male"
            parentage={p.sire_parentage}
            legacy={p.sire}
            onOpenLinked={(pid) =>
              router.push({ pathname: "/(app)/birds/[id]", params: { id: pid, fromShedId: p.shed_id } })
            }
          />
          <ParentCard
            role="Dam (Mother)"
            genderIcon="female"
            parentage={p.dam_parentage}
            legacy={p.dam}
            onOpenLinked={(pid) =>
              router.push({ pathname: "/(app)/birds/[id]", params: { id: pid, fromShedId: p.shed_id } })
            }
          />
        </View>
      </SectionCard>

      <SectionCard icon="medical-outline" title="Vaccination history">
        {vaccinations.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={28} color={birdUi.primary} />
            <Text style={styles.emptyTitle}>No vaccination records found.</Text>
            <Text style={styles.emptySub}>Any recorded vaccine history will appear here.</Text>
          </View>
        ) : (
          vaccinations.map((ev, idx) => (
            <VaccinationCard key={ev.id} event={ev} last={idx === vaccinations.length - 1} />
          ))
        )}
      </SectionCard>

      <SectionCard icon="time-outline" title="Lifecycle history">
        {lifecycle.length === 0 ? (
          <Text style={styles.emptySub}>No lifecycle events recorded.</Text>
        ) : (
          lifecycle.map((ev, idx) => (
            <LifecycleCard key={ev.id} event={ev} last={idx === lifecycle.length - 1} />
          ))
        )}
      </SectionCard>

      <Pressable
        style={styles.soldNav}
        onPress={() => router.push("/(app)/birds/sold")}
        accessibilityRole="button"
        accessibilityLabel="Open Sold Birds list"
      >
        <View style={styles.soldNavIcon}>
          <Ionicons name="pricetag-outline" size={18} color={birdUi.orange} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.soldNavTitle}>Sold Birds</Text>
          <Text style={styles.soldNavSub}>Browse all sold birds and sale history</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
      </Pressable>

      {p.is_active ? (
        <View style={styles.actionsCard}>
          {canUpdate ? (
            <ActionRow
              icon="pricetag-outline"
              color={birdUi.primary}
              label="Change band number"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/edit/[id]",
                  params: { id: p.id, fromShedId: fromShedId ?? p.shed_id },
                })
              }
            />
          ) : null}
          {canLifecycle ? (
            <ActionRow
              icon="heart-dislike-outline"
              color={birdUi.error}
              label="Record mortality"
              onPress={onMortality}
              disabled={lifeBusy}
            />
          ) : null}
          {canLifecycle ? (
            <ActionRow
              icon="swap-horizontal-outline"
              color={birdUi.blue}
              label="Transfer to another shed"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/transfer",
                  params: { shedId: p.shed_id, birdIds: p.id },
                })
              }
              last
            />
          ) : null}
        </View>
      ) : null}

      {lifeMsg ? <Text style={styles.error}>{lifeMsg}</Text> : null}

      <AppDialog
        visible={mortalityOpen}
        title="Record mortality?"
        description={
          profile.data
            ? `Bird ${profile.data.band_id ?? profile.data.display_code ?? id?.slice(0, 8)}\n\nThis marks the bird as dead and removes it from the live population. History is preserved.`
            : undefined
        }
        tone="danger"
        dismissible={!lifeBusy}
        onDismiss={() => {
          if (!lifeBusy) setMortalityOpen(false);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: lifeBusy,
          onPress: () => setMortalityOpen(false),
        }}
        primary={{
          label: "Record mortality",
          variant: "destructive",
          loading: lifeBusy,
          onPress: () => void confirmMortality(),
        }}
      />

      <AppDialog
        visible={!!reportDialog}
        title="Report ready"
        description={
          reportDialog
            ? `${reportDialog.filename}\n\nThe PDF was saved on this device. You can open or share it now.`
            : undefined
        }
        tone="success"
        icon="document-text-outline"
        dismissible
        onDismiss={() => setReportDialog(null)}
        secondary={{
          label: "Close",
          variant: "secondary",
          onPress: () => setReportDialog(null),
        }}
        primary={{
          label: "Share / Open",
          variant: "primary",
          onPress: () => {
            if (!reportDialog) return;
            void shareBirdReport(reportDialog.uri, reportDialog.filename)
              .then(() => setReportDialog(null))
              .catch((e: unknown) => {
                toast.error(e instanceof Error ? e.message : "Could not share the report.");
              });
          },
        }}
      />
    </Screen>
  );
}

function SectionCard({
  icon,
  title,
  children,
  iconColor = birdUi.primary,
  iconBg = birdUi.iconCircle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: ReactNode;
  iconColor?: string;
  iconBg?: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function SaleCell({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.saleCell}>
      <Ionicons name={icon} size={14} color={birdUi.orange} />
      <Text style={styles.saleLabel}>{label}</Text>
      <Text style={styles.saleValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function ParentCard({
  role,
  genderIcon,
  parentage,
  legacy,
  onOpenLinked,
}: {
  role: string;
  genderIcon: "male" | "female";
  parentage?: BirdParentage;
  legacy: { id: string; band_id: string | null; display_code: string | null } | null;
  onOpenLinked: (id: string) => void;
}) {
  const source = parentage?.source ?? (legacy ? "linked" : "unknown");
  const linkedId = parentage?.bird_id ?? legacy?.id ?? null;
  const name = parentage?.display_name?.trim() || null;
  const wingBand =
    parentage?.band_id?.trim() ||
    legacy?.band_id?.trim() ||
    legacy?.display_code?.trim() ||
    null;
  const titleParts = [name, wingBand].filter(Boolean);
  const title =
    titleParts.length > 0
      ? titleParts.join(" · ")
      : parentage?.label ||
        (legacy ? legacy.band_id ?? legacy.display_code ?? legacy.id.slice(0, 8) : "Unknown");
  // Older descriptive records may still include breed/notes.
  const legacyExtra = [parentage?.breed ? `Breed ${parentage.breed}` : null, parentage?.notes]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.parentCard}>
      <View style={styles.parentCardTop}>
        <Ionicons
          name={genderIcon === "male" ? "male" : "female"}
          size={14}
          color={genderIcon === "male" ? birdUi.blue : "#DB2777"}
        />
        <Text style={styles.parentRole}>{role}</Text>
      </View>
      {source === "linked" && linkedId ? (
        <Pressable onPress={() => onOpenLinked(linkedId)} accessibilityRole="link">
          <Text style={[styles.parentValue, { color: birdUi.primary }]}>{title}</Text>
        </Pressable>
      ) : (
        <Text style={styles.parentValue} selectable>
          {title}
        </Text>
      )}
      {name && wingBand ? (
        <Text style={styles.parentDetails}>
          Name {name} · Wing band {wingBand}
        </Text>
      ) : null}
      {legacyExtra && source === "manual" ? (
        <Text style={styles.parentDetails}>{legacyExtra}</Text>
      ) : null}
    </View>
  );
}

function VaccinationCard({
  event,
  last,
}: {
  event: BirdProfileVaccinationEvent;
  last?: boolean;
}) {
  const meta = [
    event.manufacturer_or_brand ? `Brand ${event.manufacturer_or_brand}` : null,
    event.lot_number ? `Lot ${event.lot_number}` : null,
    event.product_expiry ? `Exp ${formatDisplayDate(event.product_expiry)}` : null,
    event.vaccine_type_or_strain ? `Type ${event.vaccine_type_or_strain}` : null,
    event.dose_amount ? `Dose ${event.dose_amount}` : null,
    event.route ? `Route ${event.route}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const isCohort = event.coverage_scope === "cohort";

  return (
    <View style={[styles.vaxCard, !last && styles.rowBorder]}>
      <Text style={styles.vaxName}>{event.vaccine_name?.trim() || "Vaccine"}</Text>
      {isCohort ? (
        <Text style={styles.vaxCohortBadge}>
          Hatch-cohort coverage · {event.birds_covered} bird{event.birds_covered === 1 ? "" : "s"}
        </Text>
      ) : null}
      <Text style={styles.vaxDate}>Administered {formatDisplayDate(event.administration_date)}</Text>
      {meta ? <Text style={styles.vaxMeta}>{meta}</Text> : null}
      {event.notes?.trim() ? <Text style={styles.vaxMeta}>Notes: {event.notes.trim()}</Text> : null}
    </View>
  );
}

function LifecycleCard({
  event,
  last,
}: {
  event: BirdProfileLifecycle;
  last?: boolean;
}) {
  const isSale = event.event_type === "sale";
  const detail =
    event.reason?.trim() ||
    (isSale
      ? [
          event.buyer_name ? `Buyer ${event.buyer_name}` : null,
          event.buyer_mobile ? `Mobile ${event.buyer_mobile}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Bird was sold"
      : "—");

  return (
    <View style={[styles.lifeRow, !last && styles.rowBorder, isSale && styles.lifeSale]}>
      <View style={[styles.lifeDot, isSale && { backgroundColor: birdUi.orangePale }]}>
        <Ionicons
          name={isSale ? "pricetag-outline" : "ellipse"}
          size={isSale ? 14 : 8}
          color={isSale ? birdUi.orange : birdUi.primary}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.lifeTitle}>{formatLifecycleLabel(event.event_type)}</Text>
        <Text style={styles.lifeDetail}>{detail}</Text>
      </View>
      <Text style={styles.lifeDate}>{formatDisplayDate(event.effective_date)}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  color,
  label,
  onPress,
  disabled,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionRow, !last && styles.rowBorder, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
    >
      <View style={[styles.actionIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: birdUi.deepGreen,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: birdUi.primary,
    backgroundColor: birdUi.white,
    paddingHorizontal: 16,
  },
  downloadBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: birdUi.primary,
  },
  downloadHint: {
    fontSize: 12,
    color: birdUi.muted,
    lineHeight: 16,
    marginTop: -4,
  },
  summaryCard: {
    borderRadius: birdUi.cardRadius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
    minHeight: 110,
  },
  summaryArt: {
    ...StyleSheet.absoluteFill,
    opacity: 0.35,
  },
  summaryOverlay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
  },
  summaryPhoto: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryBand: { fontSize: 22, fontWeight: "800", color: birdUi.text },
  summaryName: { fontSize: 13, color: birdUi.muted, fontWeight: "600" },
  summaryStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: { backgroundColor: birdUi.successBg },
  statusDead: { backgroundColor: birdUi.errorPale },
  statusInactive: { backgroundColor: birdUi.orangePale },
  statusText: { fontSize: 13, fontWeight: "700" },
  card: {
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 14,
    paddingBottom: 8,
    paddingTop: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: birdUi.deepGreen },
  saleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 8,
  },
  saleCell: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 96,
    backgroundColor: birdUi.orangePale,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  saleLabel: { fontSize: 11, color: birdUi.muted, fontWeight: "600" },
  saleValue: { fontSize: 13, fontWeight: "800", color: birdUi.text },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: birdUi.border },
  rowLabel: { color: birdUi.muted, fontSize: 14 },
  rowValue: { color: birdUi.text, fontSize: 14, fontWeight: "700", flex: 1, textAlign: "right" },
  parentRow: { flexDirection: "row", gap: 8, paddingBottom: 8 },
  parentCard: {
    flex: 1,
    backgroundColor: birdUi.paleMint,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    minHeight: 88,
  },
  parentCardTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  parentRole: { fontSize: 12, fontWeight: "700", color: birdUi.muted },
  parentValue: { fontSize: 14, fontWeight: "800", color: birdUi.text },
  parentDetails: { fontSize: 12, color: birdUi.muted, lineHeight: 16 },
  emptyBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    backgroundColor: birdUi.paleMint,
  },
  emptyTitle: { fontSize: 14, fontWeight: "800", color: birdUi.text, textAlign: "center" },
  emptySub: { fontSize: 12, color: birdUi.muted, textAlign: "center", lineHeight: 16, marginBottom: 8 },
  vaxCard: { paddingVertical: 10, gap: 3 },
  vaxName: { fontSize: 14, fontWeight: "800", color: birdUi.text },
  vaxCohortBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "700",
    color: birdUi.primary,
    backgroundColor: birdUi.successBg,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  vaxDate: { fontSize: 13, color: birdUi.primary, fontWeight: "600" },
  vaxMeta: { fontSize: 12, color: birdUi.muted, lineHeight: 16 },
  lifeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
  },
  lifeSale: {
    backgroundColor: birdUi.orangePale,
    marginHorizontal: -6,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  lifeDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  lifeTitle: { fontWeight: "800", color: birdUi.text, fontSize: 14 },
  lifeDetail: { color: birdUi.muted, fontSize: 12, lineHeight: 16 },
  lifeDate: { fontSize: 12, fontWeight: "700", color: birdUi.muted },
  soldNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 12,
  },
  soldNavIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.orangePale,
    alignItems: "center",
    justifyContent: "center",
  },
  soldNavTitle: { fontSize: 15, fontWeight: "800", color: birdUi.text },
  soldNavSub: { fontSize: 12, color: birdUi.muted, marginTop: 2 },
  actionsCard: {
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 8,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    minHeight: 56,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: birdUi.text },
  error: { color: birdUi.error, fontWeight: "600" },
});
