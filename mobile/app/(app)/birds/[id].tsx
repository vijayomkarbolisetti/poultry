import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  getBirdProfile,
  type BirdParentage,
  type BirdProfileBatchDose,
  type BirdProfileLifecycle,
  type BirdProfileVaccinationEvent,
} from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { recordLifecycle } from "../../../src/api/flocks";
import { BirdReportActionsSheet } from "../../../src/components/birds/BirdReportActionsSheet";
import {
  SaleActionSheet,
  type SaleBandedPayload,
} from "../../../src/components/birds/SaleActionSheet";
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
  isBirdReportSaveCancelled,
  prepareBirdReportForShare,
  shareBirdReport,
} from "../../../src/features/birds/birdReportDownload";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { birdIcons, shedHeaderArt } from "../../../src/theme/media";
import { toast } from "../../../src/ui/toast/toastStore";
import { typography } from "../../../src/theme/tokens";


/** True only for real bird UUIDs — blocks mistaken routes like /birds/dead. */
function isBirdUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export default function BirdProfileScreen() {
  const { id, fromShedId } = useLocalSearchParams<{ id: string; fromShedId?: string }>();
  const birdId = Array.isArray(id) ? id[0] : id;
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const canUpdate = hasPermission(user, ownerAccountId, "bird.update");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");
  const canRecordVaccination = hasPermission(user, ownerAccountId, "vaccination.record");
  const [lifeBusy, setLifeBusy] = useState(false);
  const [lifeMsg, setLifeMsg] = useState<string | null>(null);
  const [mortalityOpen, setMortalityOpen] = useState(false);
  const [salePayload, setSalePayload] = useState<SaleBandedPayload | null>(null);
  const [vaxExpanded, setVaxExpanded] = useState(false);
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  const [lifeExpanded, setLifeExpanded] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const lifeLock = useRef(false);
  const reportLock = useRef(false);
  const lifeIdemKey = useRef<string | null>(null);
  const reserved = (birdId ?? "").trim().toLowerCase();

  const profile = useQuery({
    queryKey: ["bird-profile", birdId],
    queryFn: () => getBirdProfile(birdId!),
    enabled: isBirdUuid(birdId) && canView,
  });

  useFocusEffect(
    useCallback(() => {
      if (!isBirdUuid(birdId) || !canView) return;
      void profile.refetch();
    }, [birdId, canView]),
  );

  const backTarget = fromShedId ? `/(app)/sheds/${fromShedId}/birds` : "/(app)/search";

  const invalidateRelated = (shedId?: string, flockId?: string) => {
    void qc.invalidateQueries({ queryKey: ["bird-profile", birdId] });
    void qc.invalidateQueries({ queryKey: ["shed-birds"] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
    void qc.invalidateQueries({ queryKey: ["birds", flockId] });
    void qc.invalidateQueries({ queryKey: ["flock", flockId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["sold-birds"] });
    void qc.invalidateQueries({ queryKey: ["dead-birds"] });
  };

  const onMortality = () => {
    if (!birdId || !profile.data || lifeLock.current || !profile.data.is_active) return;
    setMortalityOpen(true);
  };

  const confirmMortality = async () => {
    if (!birdId || !profile.data || lifeLock.current) return;
    lifeLock.current = true;
    setLifeBusy(true);
    setLifeMsg(null);
    if (!lifeIdemKey.current) {
      lifeIdemKey.current = newLifecycleIdempotencyKey(`mortality-${birdId}`);
    }
    try {
      await recordLifecycle({
        event_type: "mortality",
        effective_date: todayIsoDate(),
        bird_id: birdId,
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

  const onSell = () => {
    if (!birdId || !profile.data || !profile.data.is_active) return;
    const label = profile.data.band_id ?? profile.data.display_code ?? birdId.slice(0, 8);
    setSalePayload({ mode: "banded", birdIds: [birdId], labels: [label] });
  };

  const openEdit = (section: "details" | "parentage" | "band") => {
    if (!profile.data) return;
    router.push({
      pathname: "/(app)/birds/edit/[id]",
      params: {
        id: profile.data.id,
        fromShedId: fromShedId ?? profile.data.shed_id,
        section,
      },
    });
  };

  const reportExportOpts = () => {
    if (!birdId || !profile.data) {
      throw new Error("Bird profile is not loaded yet.");
    }
    return {
      birdId,
      bandOrCode: profile.data.band_id ?? profile.data.display_code,
    };
  };

  const onReportDownload = () => {
    if (!birdId || !profile.data || reportLock.current) return;
    setReportSheetOpen(false);
    reportLock.current = true;
    setReportBusy(true);
    void (async () => {
      try {
        const result = await downloadBirdReportPdf(reportExportOpts());
        toast.success(`Saved ${result.filename} to selected folder`);
      } catch (e: unknown) {
        if (isBirdReportSaveCancelled(e)) {
          toast.info("Save cancelled — file was not written.");
          return;
        }
        const msg = e instanceof Error ? e.message : describeApiError(e, "download bird report");
        // Keep failures visible long enough to read / screenshot while debugging.
        toast.error(msg, 10_000);
      } finally {
        setReportBusy(false);
        reportLock.current = false;
      }
    })();
  };

  const onReportShare = () => {
    if (!birdId || !profile.data || reportLock.current) return;
    setReportSheetOpen(false);
    reportLock.current = true;
    setReportBusy(true);
    void (async () => {
      try {
        const result = await prepareBirdReportForShare(reportExportOpts());
        await shareBirdReport(result.uri, result.filename);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : describeApiError(e, "share bird report");
        toast.error(msg, 10_000);
      } finally {
        setReportBusy(false);
        reportLock.current = false;
      }
    })();
  };

  // After hooks: recover if a static history path was captured by birds/[id].
  if (reserved === "dead" || reserved === "dead-birds") {
    return <Redirect href="/(app)/birds/dead-birds" />;
  }
  if (reserved === "sold") {
    return <Redirect href="/(app)/birds/sold" />;
  }

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view bird profiles.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(backTarget)} />
      </Screen>
    );
  }

  if (!isBirdUuid(birdId)) {
    return (
      <Screen>
        <Text style={styles.error}>This bird link is not valid.</Text>
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
  const hatchShort =
    p.hatch_date != null
      ? formatDisplayDate(p.hatch_date)
      : p.estimated_age_days != null
        ? "Estimated"
        : p.dob_confidence === "unknown"
          ? "Unknown"
          : formatLifecycleLabel(p.dob_confidence);
  const ageShort =
    p.hatch_date != null || p.estimated_age_days != null
      ? formatRelativeAgeLabel({
          hatch_date: p.hatch_date,
          estimated_age_days: p.estimated_age_days,
        })
      : null;
  const hatchAgeDetail =
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
  const shedName = p.shed_name?.trim() || "—";
  const notes = p.notes?.trim() || "";
  const sexLabel = formatSexLabel(p.sex);
  const breedLabel = p.breed?.trim() || "—";

  const vaccinations = [...(p.individual_vaccinations ?? [])].sort((a, b) =>
    a.administration_date < b.administration_date ? 1 : -1,
  );
  const upcomingDoses = [...(p.batch_upcoming_doses ?? [])].sort((a, b) =>
    a.due_date < b.due_date ? -1 : 1,
  );
  const lifecycle = [...(p.lifecycle_events ?? [])].sort((a, b) =>
    a.effective_date < b.effective_date ? 1 : -1,
  );
  const visibleVax = vaxExpanded ? vaccinations : vaccinations.slice(0, 1);
  const visibleUpcoming = upcomingExpanded ? upcomingDoses : upcomingDoses.slice(0, 3);
  const visibleLife = lifeExpanded ? lifecycle : lifecycle.slice(0, 1);

  const statusKey = (p.lifecycle_status || "").toLowerCase();
  const statusTone =
    statusKey === "active" ? "active" : statusKey === "dead" ? "dead" : "inactive";

  const hasParentage =
    hasParentInfo(p.sire_parentage, p.sire) || hasParentInfo(p.dam_parentage, p.dam);

  return (
    <Screen
      scroll
      // Custom in-screen header (no stack nav bar) — include top so status bar is cleared once.
      edges={["top", "left", "right", "bottom"]}
      style={{ backgroundColor: birdUi.bg, gap: 12, paddingBottom: 28 }}
    >
      <View style={styles.topBar}>
        <Pressable onPress={() => safeBack(backTarget)} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={styles.topTitleBlock}>
          <Text style={styles.screenTitle}>Bird Profile</Text>
          <Text style={styles.screenSub}>Details, actions, and history</Text>
        </View>
        <Pressable
          onPress={() => {
            if (!reportBusy) setReportSheetOpen(true);
          }}
          disabled={reportBusy}
          style={[styles.downloadIconBtn, reportBusy && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Export bird report"
          accessibilityState={{ busy: reportBusy }}
        >
          {reportBusy ? (
            <ActivityIndicator size="small" color={birdUi.primary} />
          ) : (
            <Ionicons name="download-outline" size={20} color={birdUi.primary} />
          )}
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <Image source={shedHeaderArt} style={styles.summaryArt} resizeMode="cover" />
        <View style={styles.summaryBody}>
          <View style={styles.summaryTop}>
            <View style={styles.summaryPhoto}>
              <Image source={birdIcons.bird} style={styles.summaryPhotoImg} resizeMode="cover" />
            </View>
            <View style={styles.summaryIdentity}>
              <Text style={styles.summaryBand} selectable>
                {title}
              </Text>
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

          <View style={styles.summaryMetaRow}>
            <SummaryMeta
              icon="calendar-outline"
              label="Hatched"
              value={hatchShort}
              sub={ageShort ? `${ageShort} old` : undefined}
            />
            <SummaryMeta
              icon={sexLabel === "Female" ? "female" : "male"}
              iconImage={sexLabel === "Female" ? birdIcons.female : birdIcons.male}
              label="Sex"
              value={sexLabel}
              sub={breedLabel !== "—" ? breedLabel : undefined}
            />
            <SummaryMeta icon="home-outline" label="Shed" value={shedName} />
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

      {p.is_active ? (
        <View style={styles.actionsGrid}>
          {canUpdate ? (
            <ActionTile
              icon="pricetag-outline"
              color={birdUi.primary}
              bg={birdUi.paleMint}
              label="Change band number"
              onPress={() => openEdit("band")}
            />
          ) : null}
          {canLifecycle ? (
            <ActionTile
              icon="pricetag"
              color={birdUi.orange}
              bg={birdUi.orangePale}
              label="Sell bird"
              onPress={onSell}
            />
          ) : null}
          {canLifecycle ? (
            <ActionTile
              icon="heart-dislike-outline"
              color={birdUi.error}
              bg={birdUi.errorPale}
              label="Record mortality"
              onPress={onMortality}
              disabled={lifeBusy}
            />
          ) : null}
          {canLifecycle ? (
            <ActionTile
              icon="swap-horizontal-outline"
              color={birdUi.blue}
              bg={birdUi.bluePale}
              label="Transfer to another shed"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/transfer",
                  params: { shedId: p.shed_id, birdIds: p.id },
                })
              }
            />
          ) : null}
          {canRecordVaccination ? (
            <ActionTile
              icon="medkit-outline"
              color={birdUi.primary}
              bg={birdUi.paleMint}
              label="Record vaccination"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/record-vaccination",
                  params: {
                    shedId: p.shed_id,
                    birdIds: p.id,
                    labels: p.band_id?.trim() || p.display_code?.trim() || p.id,
                    flockId: p.flock_id,
                  },
                })
              }
            />
          ) : null}
        </View>
      ) : null}

      <SectionCard
        icon="paw-outline"
        title="Bird details"
        action={
          canUpdate ? (
            <HeaderAction label="Edit" onPress={() => openEdit("details")} />
          ) : undefined
        }
      >
        <DetailRow label="Band number" value={p.band_id?.trim() || "—"} />
        <DetailRow label="Bird name / code" value={p.display_code?.trim() || "—"} />
        <DetailRow label="Shed" value={shedName} />
        <DetailRow label="Hatch date / age" value={hatchAgeDetail} />
        <DetailRow label="Breed" value={breedLabel} />
        <DetailRow label="Sex" value={sexLabel} />
        <DetailRow label="Added on" value={addedOn} last={!notes} />
        {notes ? <DetailRow label="Notes" value={notes} last /> : null}
      </SectionCard>

      <SectionCard
        icon="people-outline"
        title="Parentage"
        action={
          canUpdate ? (
            <HeaderAction
              label={hasParentage ? "Edit" : "Add"}
              onPress={() => openEdit("parentage")}
            />
          ) : undefined
        }
      >
        {hasParentage ? (
          <View style={styles.parentRow}>
            <ParentCard
              role="Sire (Father)"
              genderIcon="male"
              parentage={p.sire_parentage}
              legacy={p.sire}
              onOpenLinked={(pid) =>
                router.push({
                  pathname: "/(app)/birds/[id]",
                  params: { id: pid, fromShedId: p.shed_id },
                })
              }
            />
            <ParentCard
              role="Dam (Mother)"
              genderIcon="female"
              parentage={p.dam_parentage}
              legacy={p.dam}
              onOpenLinked={(pid) =>
                router.push({
                  pathname: "/(app)/birds/[id]",
                  params: { id: pid, fromShedId: p.shed_id },
                })
              }
            />
          </View>
        ) : (
          <Pressable
            style={styles.parentEmpty}
            onPress={canUpdate ? () => openEdit("parentage") : undefined}
            disabled={!canUpdate}
            accessibilityRole="button"
            accessibilityLabel="Add parentage"
          >
            <Ionicons name="git-branch-outline" size={22} color={birdUi.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.parentEmptyTitle}>No parentage recorded</Text>
              <Text style={styles.parentEmptySub}>
                {canUpdate ? "Add sire and dam details" : "Parent details are not available"}
              </Text>
            </View>
            {canUpdate ? <Ionicons name="add-circle-outline" size={22} color={birdUi.primary} /> : null}
          </Pressable>
        )}
      </SectionCard>

      <SectionCard
        icon="medical-outline"
        title="Vaccination history"
        action={
          vaccinations.length > 1 ? (
            <HeaderAction
              label={vaxExpanded ? "Show less" : "View all"}
              onPress={() => setVaxExpanded((v) => !v)}
            />
          ) : undefined
        }
      >
        {vaccinations.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={24} color={birdUi.primary} />
            <Text style={styles.emptyTitle}>No vaccination records</Text>
            <Text style={styles.emptySub}>Recorded vaccines will appear here.</Text>
          </View>
        ) : (
          visibleVax.map((ev, idx) => (
            <VaccinationCard
              key={ev.id}
              event={ev}
              last={idx === visibleVax.length - 1}
            />
          ))
        )}
      </SectionCard>

      <SectionCard
        icon="alarm-outline"
        title="Upcoming vaccinations"
        action={
          upcomingDoses.length > 3 ? (
            <HeaderAction
              label={upcomingExpanded ? "Show less" : "View all"}
              onPress={() => setUpcomingExpanded((v) => !v)}
            />
          ) : undefined
        }
      >
        {upcomingDoses.length === 0 ? (
          <Text style={styles.emptySub}>
            {p.is_active
              ? "No remaining hatch-date doses are scheduled."
              : "No remaining hatch-date doses are on record for this bird."}
          </Text>
        ) : (
          <>
            {!p.is_active ? (
              <Text style={styles.emptySub}>
                Remaining flock schedule for records only. New vaccinations cannot be recorded.
              </Text>
            ) : null}
            {visibleUpcoming.map((dose, idx) => (
              <UpcomingDoseCard
                key={dose.id}
                dose={dose}
                last={idx === visibleUpcoming.length - 1}
              />
            ))}
          </>
        )}
      </SectionCard>

      <SectionCard
        icon="time-outline"
        title="Lifecycle history"
        action={
          lifecycle.length > 1 ? (
            <HeaderAction
              label={lifeExpanded ? "Show less" : "View all"}
              onPress={() => setLifeExpanded((v) => !v)}
            />
          ) : undefined
        }
      >
        {lifecycle.length === 0 ? (
          <Text style={styles.emptySub}>No lifecycle events recorded.</Text>
        ) : (
          visibleLife.map((ev, idx) => (
            <LifecycleCard key={ev.id} event={ev} last={idx === visibleLife.length - 1} />
          ))
        )}
      </SectionCard>

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

      {lifeMsg ? <Text style={styles.error}>{lifeMsg}</Text> : null}

      <SaleActionSheet
        visible={!!salePayload}
        payload={salePayload}
        onClose={() => setSalePayload(null)}
        onSuccess={() => {
          setSalePayload(null);
          invalidateRelated(p.shed_id, p.flock_id);
          void profile.refetch();
        }}
      />

      <AppDialog
        visible={mortalityOpen}
        title="Record mortality?"
        description={
          profile.data
            ? `Bird ${profile.data.band_id ?? profile.data.display_code ?? birdId?.slice(0, 8)}\n\nThis marks the bird as dead and removes it from the live population. History is preserved.`
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

      <BirdReportActionsSheet
        visible={reportSheetOpen}
        busy={reportBusy}
        onClose={() => {
          if (!reportBusy) setReportSheetOpen(false);
        }}
        onDownload={onReportDownload}
        onShare={onReportShare}
      />
    </Screen>
  );
}

function hasParentInfo(
  parentage: BirdParentage | undefined,
  legacy: { id: string; band_id: string | null; display_code: string | null } | null,
): boolean {
  if (legacy) return true;
  if (!parentage) return false;
  if (parentage.source === "unknown") return false;
  return !!(
    parentage.bird_id ||
    parentage.display_name?.trim() ||
    parentage.band_id?.trim() ||
    (parentage.label && parentage.label.toLowerCase() !== "unknown")
  );
}

function SectionCard({
  icon,
  title,
  children,
  action,
  iconColor = birdUi.primary,
  iconBg = birdUi.iconCircle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: ReactNode;
  action?: ReactNode;
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
        {action}
      </View>
      {children}
    </View>
  );
}

function HeaderAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={styles.headerAction}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.headerActionText}>{label}</Text>
    </Pressable>
  );
}

function SummaryMeta({
  icon,
  iconImage,
  label,
  value,
  sub,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconImage?: number;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.summaryMeta}>
      <View style={styles.summaryMetaIcon}>
        {iconImage != null ? (
          <Image source={iconImage} style={styles.summaryMetaIconImg} resizeMode="cover" />
        ) : (
          <Ionicons name={icon} size={14} color={birdUi.primary} />
        )}
      </View>
      <Text style={styles.summaryMetaLabel}>{label}</Text>
      <Text style={styles.summaryMetaValue} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={styles.summaryMetaSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
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
  const title =
    name ||
    wingBand ||
    parentage?.label ||
    (legacy ? legacy.band_id ?? legacy.display_code ?? legacy.id.slice(0, 8) : "Unknown");
  const accent = genderIcon === "male" ? birdUi.blue : "#DB2777";

  const body = (
    <>
      <View style={styles.parentCardTop}>
        <View style={[styles.parentAvatar, { borderColor: `${accent}44` }]}>
          <Image
            source={genderIcon === "male" ? birdIcons.male : birdIcons.female}
            style={styles.parentAvatarImg}
            resizeMode="cover"
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.parentRoleRow}>
            <Image
              source={genderIcon === "male" ? birdIcons.male : birdIcons.female}
              style={styles.parentRoleIcon}
              resizeMode="cover"
            />
            <Text style={styles.parentRole}>{role}</Text>
          </View>
          <Text
            style={[styles.parentValue, source === "linked" && linkedId ? { color: birdUi.primary } : null]}
            numberOfLines={2}
            selectable={source !== "linked"}
          >
            {title}
          </Text>
          {name && wingBand ? (
            <Text style={styles.parentDetails}>Wing band {wingBand}</Text>
          ) : null}
        </View>
      </View>
    </>
  );

  if (source === "linked" && linkedId) {
    return (
      <Pressable
        style={styles.parentCard}
        onPress={() => onOpenLinked(linkedId)}
        accessibilityRole="link"
      >
        {body}
      </Pressable>
    );
  }

  return <View style={styles.parentCard}>{body}</View>;
}

function formatUpcomingDoseStatus(status: string | null | undefined): string {
  const raw = (status ?? "").toLowerCase().trim();
  if (raw === "due_soon") return "Due soon";
  if (raw === "due_today") return "Due today";
  if (raw === "needs_review") return "Needs review";
  if (raw === "inactive") return "Schedule closed";
  if (!raw) return "—";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function UpcomingDoseCard({
  dose,
  last,
}: {
  dose: BirdProfileBatchDose;
  last?: boolean;
}) {
  return (
    <View style={[styles.vaxCard, !last && styles.rowBorder]}>
      <View style={styles.vaxTitleRow}>
        <Text style={styles.vaxName}>{dose.vaccine_name?.trim() || "Vaccine"}</Text>
        <Text style={styles.vaxDate}>{formatDisplayDate(dose.due_date)}</Text>
      </View>
      <Text style={styles.vaxCohortBadge}>
        Dose {dose.dose_number} · {formatUpcomingDoseStatus(dose.status)}
      </Text>
      <Text style={styles.vaxMeta}>
        Hatch-date schedule · {dose.completed_count} of {dose.eligible_count} birds covered
      </Text>
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
    event.vaccine_type_or_strain ? `Strain ${event.vaccine_type_or_strain}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const isCohort = event.coverage_scope === "cohort";
  const kindLabel =
    event.recording_kind === "scheduled" || event.scheduled_dose_id
      ? "Scheduled"
      : "Manual";

  return (
    <View style={[styles.vaxCard, !last && styles.rowBorder]}>
      <View style={styles.vaxTitleRow}>
        <Text style={styles.vaxName}>{event.vaccine_name?.trim() || "Vaccine"}</Text>
        <Text style={styles.vaxDate}>{formatDisplayDate(event.administration_date)}</Text>
      </View>
      <Text style={styles.vaxCohortBadge}>{kindLabel} vaccination</Text>
      {isCohort ? (
        <Text style={styles.vaxCohortBadge}>
          Hatch-cohort coverage · {event.birds_covered} bird{event.birds_covered === 1 ? "" : "s"}
        </Text>
      ) : null}
      {meta ? <Text style={styles.vaxMeta}>{meta}</Text> : null}
      {event.notes?.trim() ? <Text style={styles.vaxMeta}>{event.notes.trim()}</Text> : null}
    </View>
  );
}

function lifecycleEventDetail(event: BirdProfileLifecycle): string {
  const fromName = event.from_shed_name?.trim();
  const toName = event.to_shed_name?.trim();
  if (fromName && toName) return `From ${fromName} to ${toName}`;
  if (toName) return `Transferred to ${toName}`;
  if (fromName) return `Transferred from ${fromName}`;

  const raw = event.reason?.trim() ?? "";
  const cleaned = raw
    .replace(/^\[shed-move(?:-batch)?\]\s*/i, "")
    .replace(/^\[band-from-unbanded\]\s*/i, "Band assigned: ")
    .trim();
  if (cleaned) return cleaned;

  if (event.event_type === "sale") {
    return (
      [
        event.buyer_name ? `Buyer ${event.buyer_name}` : null,
        event.buyer_mobile ? `Mobile ${event.buyer_mobile}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Bird was sold"
    );
  }
  return "—";
}

function LifecycleCard({
  event,
  last,
}: {
  event: BirdProfileLifecycle;
  last?: boolean;
}) {
  const isSale = event.event_type === "sale";
  const detail = lifecycleEventDetail(event);

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

function ActionTile({
  icon,
  color,
  bg,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionTile, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.actionTileIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.actionTileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 2,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitleBlock: { flex: 1, gap: 1 },
  screenTitle: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.deepGreen,
  },
  screenSub: {
    fontSize: typography.caption.fontSize,
    color: birdUi.muted,
    fontWeight: "500",
  },
  downloadIconBtn: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: birdUi.primary,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  summaryCard: {
    borderRadius: birdUi.cardRadius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  summaryArt: {
    ...StyleSheet.absoluteFill,
    opacity: 0.22,
  },
  summaryBody: {
    padding: 14,
    gap: 14,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryPhoto: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: birdUi.white,
    borderWidth: 2,
    borderColor: birdUi.white,
    overflow: "hidden",
  },
  summaryPhotoImg: { width: "100%", height: "100%" },
  summaryIdentity: { flex: 1, gap: 8 },
  summaryBand: { fontSize: typography.bandInput.fontSize, fontWeight: "800", color: birdUi.text },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: { backgroundColor: birdUi.successBg },
  statusDead: { backgroundColor: birdUi.errorPale },
  statusInactive: { backgroundColor: birdUi.orangePale },
  statusText: { fontSize: typography.overline.fontSize, fontWeight: "700" },
  summaryMetaRow: {
    flexDirection: "row",
    gap: 8,
  },
  summaryMeta: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 2,
    borderWidth: 1,
    borderColor: birdUi.border,
  },
  summaryMetaIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
    overflow: "hidden",
  },
  summaryMetaIconImg: { width: "100%", height: "100%" },
  summaryMetaLabel: { fontSize: typography.overline.fontSize, color: birdUi.muted, fontWeight: "600" },
  summaryMetaValue: { fontSize: typography.secondary.fontSize, fontWeight: "800", color: birdUi.text },
  summaryMetaSub: { fontSize: typography.overline.fontSize, color: birdUi.muted, fontWeight: "600" },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionTile: {
    width: "48.5%",
    flexGrow: 1,
    minWidth: "46%",
    minHeight: 72,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionTileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTileLabel: {
    flex: 1,
    fontSize: typography.label.fontSize,
    fontWeight: "700",
    color: birdUi.text,
    lineHeight: 18,
  },
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
  cardTitle: { flex: 1, fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  headerAction: {
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActionText: { fontSize: typography.secondary.fontSize, fontWeight: "800", color: birdUi.primary },
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
  saleLabel: { fontSize: typography.label.fontSize, color: birdUi.muted, fontWeight: "600" },
  saleValue: { fontSize: typography.secondary.fontSize, fontWeight: "800", color: birdUi.text },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: birdUi.border },
  rowLabel: { color: birdUi.muted, fontSize: typography.label.fontSize },
  rowValue: { color: birdUi.text, fontSize: typography.bodyStrong.fontSize, fontWeight: "700", flex: 1, textAlign: "right" },
  parentRow: { flexDirection: "row", gap: 8, paddingBottom: 8 },
  parentCard: {
    flex: 1,
    backgroundColor: birdUi.paleMint,
    borderRadius: 12,
    padding: 10,
    gap: 4,
    minHeight: 72,
  },
  parentCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  parentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1.5,
    backgroundColor: birdUi.white,
  },
  parentAvatarImg: { width: "100%", height: "100%" },
  parentRoleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  parentRoleIcon: { width: 14, height: 14, borderRadius: 7 },
  parentRole: { fontSize: typography.overline.fontSize, fontWeight: "700", color: birdUi.muted },
  parentValue: { fontSize: typography.secondary.fontSize, fontWeight: "800", color: birdUi.text },
  parentDetails: { fontSize: typography.overline.fontSize, color: birdUi.muted, lineHeight: 15 },
  parentEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: birdUi.paleMint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    minHeight: 56,
  },
  parentEmptyTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  parentEmptySub: { fontSize: typography.caption.fontSize, color: birdUi.muted },
  emptyBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
    backgroundColor: birdUi.paleMint,
  },
  emptyTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text, textAlign: "center" },
  emptySub: {
    fontSize: typography.caption.fontSize,
    color: birdUi.muted,
    textAlign: "center",
    lineHeight: 16,
    marginBottom: 8,
  },
  vaxCard: { paddingVertical: 10, gap: 4 },
  vaxTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  vaxName: { flex: 1, fontSize: typography.label.fontSize, fontWeight: "800", color: birdUi.text },
  vaxCohortBadge: {
    alignSelf: "flex-start",
    fontSize: typography.overline.fontSize,
    fontWeight: "700",
    color: birdUi.primary,
    backgroundColor: birdUi.successBg,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  vaxDate: { fontSize: typography.secondary.fontSize, color: birdUi.primary, fontWeight: "700" },
  vaxMeta: { fontSize: typography.caption.fontSize, color: birdUi.muted, lineHeight: 16 },
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
  lifeTitle: { fontWeight: "800", color: birdUi.text, fontSize: typography.sectionTitle.fontSize },
  lifeDetail: { color: birdUi.muted, fontSize: typography.caption.fontSize, lineHeight: 16 },
  lifeDate: { fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.muted },
  error: { color: birdUi.error, fontWeight: "600" },
});
