"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/ui/icons";
import { Comparison } from "./comparison-shell";
import styles from "./animation-audit-lab.module.css";

interface CohesionComparisonsProps {
  readonly replayKey: number;
  readonly stress: boolean;
}

export default function CohesionComparisons({
  replayKey,
  stress,
}: CohesionComparisonsProps) {
  return (
    <>
      <TokenComparison replayKey={replayKey} />
      <ModalComparison replayKey={replayKey} />
      <SidebarComparison replayKey={replayKey} />
      <SkeletonComparison replayKey={replayKey} stress={stress} />
    </>
  );
}

function TokenComparison({ replayKey }: { readonly replayKey: number }) {
  const t = useTranslations("animationAuditLab");
  return (
    <Comparison
      title={t("scenarios.tokens.title")}
      description={t("scenarios.tokens.description")}
      beforeNote={t("scenarios.tokens.beforeNote")}
      afterNote={t("scenarios.tokens.afterNote")}
      before={
        <div key={`before-tokens-${replayKey}`} className={styles.motionLanes}>
          <MotionLane
            label={t("scenarios.tokens.enter")}
            value="240ms · cubic-bezier(.22,1,.36,1)"
            className={styles.beforeLaneA}
          />
          <MotionLane
            label={t("scenarios.tokens.move")}
            value="300ms · cubic-bezier(.4,0,.2,1)"
            className={styles.beforeLaneB}
          />
          <MotionLane
            label={t("scenarios.tokens.drawer")}
            value="400ms · cubic-bezier(.16,1,.3,1)"
            className={styles.beforeLaneC}
          />
        </div>
      }
      after={
        <div key={`after-tokens-${replayKey}`} className={styles.motionLanes}>
          <MotionLane
            label={t("scenarios.tokens.enter")}
            value="--ease-out · 180ms"
            className={styles.afterLaneEnter}
          />
          <MotionLane
            label={t("scenarios.tokens.move")}
            value="--ease-in-out · 200ms"
            className={styles.afterLaneMove}
          />
          <MotionLane
            label={t("scenarios.tokens.drawer")}
            value="--ease-drawer · 280ms"
            className={styles.afterLaneDrawer}
          />
        </div>
      }
    />
  );
}

function MotionLane({
  label,
  value,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly className: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-semibold text-[var(--glass-text-secondary)]">
        <span>{label}</span>
        <code className="text-[10px] text-[var(--glass-text-tertiary)]">
          {value}
        </code>
      </div>
      <div className={styles.motionLane}>
        <span className={`${styles.motionLaneDot} ${className}`} />
      </div>
    </div>
  );
}

function ModalComparison({ replayKey }: { readonly replayKey: number }) {
  const t = useTranslations("animationAuditLab");
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen((value) => !value), [replayKey]);

  return (
    <Comparison
      title={t("scenarios.modal.title")}
      description={t("scenarios.modal.description")}
      beforeNote={t("scenarios.modal.beforeNote")}
      afterNote={t("scenarios.modal.afterNote")}
      before={
        <ModalDemo
          open={open}
          improved={false}
          onToggle={() => setOpen((value) => !value)}
        />
      }
      after={
        <ModalDemo
          open={open}
          improved
          onToggle={() => setOpen((value) => !value)}
        />
      }
    />
  );
}

function ModalDemo({
  open,
  improved,
  onToggle,
}: {
  readonly open: boolean;
  readonly improved: boolean;
  readonly onToggle: () => void;
}) {
  const t = useTranslations("animationAuditLab");
  return (
    <div className={styles.miniOverlayStage}>
      <button
        type="button"
        onClick={onToggle}
        className={styles.opportunityTrigger}
      >
        {open ? t("common.close") : t("common.open")}
      </button>
      {improved ? (
        <div
          className={`${styles.afterMiniModalLayer} ${open ? styles.afterMiniModalLayerOpen : ""}`}
          aria-hidden={!open}
        >
          <div className={styles.miniBackdrop} />
          <MiniModal onClose={onToggle} />
        </div>
      ) : open ? (
        <div className={styles.beforeMiniModalLayer}>
          <div className={styles.miniBackdrop} />
          <MiniModal onClose={onToggle} />
        </div>
      ) : null}
    </div>
  );
}

function MiniModal({ onClose }: { readonly onClose: () => void }) {
  const t = useTranslations("animationAuditLab");
  return (
    <div className={styles.miniModal}>
      <div>
        <div className="text-sm font-bold text-[var(--glass-text-primary)]">
          {t("common.projectName")}
        </div>
        <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
          {t("common.ready")}
        </div>
      </div>
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className={styles.miniClose}
      >
        <AppIcon name="close" className="h-4 w-4" />
      </button>
    </div>
  );
}

function SidebarComparison({ replayKey }: { readonly replayKey: number }) {
  const t = useTranslations("animationAuditLab");
  const [open, setOpen] = useState(true);

  useEffect(() => setOpen((value) => !value), [replayKey]);

  return (
    <Comparison
      title={t("scenarios.sidebar.title")}
      description={t("scenarios.sidebar.description")}
      beforeNote={t("scenarios.sidebar.beforeNote")}
      afterNote={t("scenarios.sidebar.afterNote")}
      before={
        <SidebarDemo
          open={open}
          improved={false}
          onToggle={() => setOpen((value) => !value)}
        />
      }
      after={
        <SidebarDemo
          open={open}
          improved
          onToggle={() => setOpen((value) => !value)}
        />
      }
    />
  );
}

function SidebarDemo({
  open,
  improved,
  onToggle,
}: {
  readonly open: boolean;
  readonly improved: boolean;
  readonly onToggle: () => void;
}) {
  const t = useTranslations("animationAuditLab");
  return (
    <div className={styles.sidebarStage}>
      <button
        type="button"
        onClick={onToggle}
        className={styles.sidebarHandle}
        aria-expanded={open}
        aria-label={open ? t("common.close") : t("common.open")}
      >
        <AppIcon
          name="chevronRight"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {improved ? (
        <div
          className={`${styles.sidebarPanel} ${styles.afterSidebarPanel} ${open ? styles.sidebarPanelOpen : ""}`}
          aria-hidden={!open}
        >
          <SidebarContent />
        </div>
      ) : open ? (
        <div className={`${styles.sidebarPanel} ${styles.beforeSidebarPanel}`}>
          <SidebarContent />
        </div>
      ) : null}
      <span className={styles.sidebarHint}>
        {open ? t("common.close") : t("common.open")}
      </span>
    </div>
  );
}

function SidebarContent() {
  const t = useTranslations("animationAuditLab");
  return (
    <div className="space-y-2 p-3">
      <div className="text-xs font-bold text-[var(--glass-text-primary)]">
        {t("common.projectName")}
      </div>
      {[1, 2, 3].map((index) => (
        <span key={index} className={styles.sidebarLine} />
      ))}
    </div>
  );
}

function SkeletonComparison({ replayKey, stress }: CohesionComparisonsProps) {
  const t = useTranslations("animationAuditLab");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLoaded((value) => !value), [replayKey]);

  useEffect(() => {
    if (!stress) return undefined;
    const interval = window.setInterval(
      () => setLoaded((value) => !value),
      900,
    );
    return () => window.clearInterval(interval);
  }, [stress]);

  return (
    <Comparison
      title={t("scenarios.skeleton.title")}
      description={t("scenarios.skeleton.description")}
      beforeNote={t("scenarios.skeleton.beforeNote")}
      afterNote={t("scenarios.skeleton.afterNote")}
      before={<SkeletonDemo loaded={loaded} improved={false} />}
      after={<SkeletonDemo loaded={loaded} improved />}
    />
  );
}

function SkeletonDemo({
  loaded,
  improved,
}: {
  readonly loaded: boolean;
  readonly improved: boolean;
}) {
  const t = useTranslations("animationAuditLab");
  if (!improved)
    return loaded ? (
      <ProjectContent label={t("common.content")} />
    ) : (
      <SkeletonContent label={t("common.empty")} />
    );

  return (
    <div className={styles.crossfadeStage}>
      <div
        className={`${styles.crossfadeLayer} ${loaded ? styles.crossfadeHidden : styles.crossfadeVisible}`}
      >
        <SkeletonContent label={t("common.empty")} />
      </div>
      <div
        className={`${styles.crossfadeLayer} ${loaded ? styles.crossfadeVisible : styles.crossfadeHidden}`}
      >
        <ProjectContent label={t("common.content")} />
      </div>
    </div>
  );
}

function SkeletonContent({ label }: { readonly label: string }) {
  return (
    <div className={styles.skeletonCard} aria-label={label}>
      <span className={`${styles.skeletonLine} w-2/3`} />
      <span className={`${styles.skeletonLine} w-full`} />
      <span className={`${styles.skeletonLine} w-4/5`} />
    </div>
  );
}

function ProjectContent({ label }: { readonly label: string }) {
  return (
    <div className={styles.loadedCard}>
      <div className={styles.loadedThumb}>
        <AppIcon name="clapperboard" className="h-5 w-5 text-white" />
      </div>
      <div>
        <div className="text-sm font-bold text-[var(--glass-text-primary)]">
          {label}
        </div>
        <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
          01 · 02 · 03
        </div>
      </div>
    </div>
  );
}
