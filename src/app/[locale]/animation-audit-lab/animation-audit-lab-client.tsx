"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AppIcon } from "@/components/ui/icons";
import { LabButton, Section } from "./comparison-shell";
import PurposeComparisons from "./purpose-comparisons";
import PerformanceComparisons from "./performance-comparisons";
import InteractionComparisons from "./interaction-comparisons";
import AccessibilityComparison from "./accessibility-comparison";
import CohesionComparisons from "./cohesion-comparisons";
import styles from "./animation-audit-lab.module.css";

export default function AnimationAuditLabClient() {
  const t = useTranslations("animationAuditLab");
  const [replayKey, setReplayKey] = useState(0);
  const [stress, setStress] = useState(false);
  const [simulateReducedMotion, setSimulateReducedMotion] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystemReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const reducedMotion = simulateReducedMotion || systemReducedMotion;

  return (
    <main
      className={styles.labRoot}
      data-reduce-motion={reducedMotion ? "true" : "false"}
      data-stress={stress ? "true" : "false"}
    >
      <div className={styles.backgroundGrid} />
      <div className="relative mx-auto max-w-[1500px] px-4 pb-20 pt-5 sm:px-6 lg:px-8">
        <nav className="mb-10 flex items-center justify-between">
          <Link
            href={{ pathname: "/home" }}
            className="glass-btn-base glass-btn-secondary inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm"
          >
            <AppIcon name="chevronLeft" className="h-4 w-4" />
            {t("nav.back")}
          </Link>
          <span className={styles.livePill}>
            <span className={styles.liveDot} />
            {t("hero.live")}
          </span>
        </nav>

        <header className={styles.hero}>
          <div className={styles.heroGlow} />
          <div className="relative z-10 max-w-4xl">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-600">
              {t("hero.eyebrow")}
            </p>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.055em] text-slate-950 sm:text-5xl lg:text-7xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
              {t("hero.subtitle")}
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <HeroBadge icon="check" label={t("hero.realBadge")} />
              <HeroBadge
                icon="sparklesAlt"
                label={t("hero.interactiveBadge")}
              />
              <HeroBadge icon="fileText" label={t("hero.sourceBadge")} />
            </div>
          </div>
          <div className={styles.heroOrbit} aria-hidden="true">
            <span className={styles.orbitA} />
            <span className={styles.orbitB} />
            <span className={styles.orbitCore}>
              <AppIcon name="sparklesAlt" className="h-7 w-7" />
            </span>
          </div>
        </header>

        <div className={styles.controlDock}>
          <div className="flex flex-wrap gap-2">
            <LabButton onClick={() => setReplayKey((value) => value + 1)}>
              <AppIcon name="refresh" className="mr-1 h-3.5 w-3.5" />
              {t("controls.replayAll")}
            </LabButton>
            <LabButton
              pressed={stress}
              onClick={() => setStress((value) => !value)}
            >
              <AppIcon name="bolt" className="mr-1 h-3.5 w-3.5" />
              {t("controls.stress")}
            </LabButton>
            <LabButton
              pressed={simulateReducedMotion}
              onClick={() => setSimulateReducedMotion((value) => !value)}
            >
              <AppIcon name="eye" className="mr-1 h-3.5 w-3.5" />
              {t("controls.reduce")}
            </LabButton>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
            <StatusPill
              active={stress}
              label={stress ? t("controls.stressOn") : t("controls.stressOff")}
            />
            <StatusPill
              active={reducedMotion}
              label={
                reducedMotion ? t("controls.reduceOn") : t("controls.reduceOff")
              }
            />
            <span className={styles.systemPreference}>
              {t("controls.systemPreference", {
                value: systemReducedMotion
                  ? t("controls.on")
                  : t("controls.off"),
              })}
            </span>
          </div>
        </div>

        <div className="mt-16 space-y-20">
          <Section
            title={t("sections.purpose.title")}
            description={t("sections.purpose.description")}
          >
            <PurposeComparisons />
          </Section>

          <Section
            title={t("sections.performance.title")}
            description={t("sections.performance.description")}
          >
            <PerformanceComparisons replayKey={replayKey} stress={stress} />
          </Section>

          <Section
            title={t("sections.interruptibility.title")}
            description={t("sections.interruptibility.description")}
          >
            <InteractionComparisons replayKey={replayKey} stress={stress} />
          </Section>

          <Section
            title={t("sections.accessibility.title")}
            description={t("sections.accessibility.description")}
          >
            <AccessibilityComparison />
          </Section>

          <Section
            title={t("sections.cohesion.title")}
            description={t("sections.cohesion.description")}
          >
            <CohesionComparisons replayKey={replayKey} stress={stress} />
          </Section>
        </div>

        <footer className={styles.footerCard}>
          <AppIcon name="sparklesAlt" className="h-6 w-6 text-blue-600" />
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              {t("footer.title")}
            </h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <li>01 · {t("footer.itemA")}</li>
              <li>02 · {t("footer.itemB")}</li>
              <li>03 · {t("footer.itemC")}</li>
            </ul>
          </div>
        </footer>
      </div>
    </main>
  );
}

function HeroBadge({
  icon,
  label,
}: {
  readonly icon: "check" | "sparklesAlt" | "fileText";
  readonly label: string;
}) {
  return (
    <span className={styles.heroBadge}>
      <AppIcon name={icon} className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function StatusPill({
  active,
  label,
}: {
  readonly active: boolean;
  readonly label: string;
}) {
  return (
    <span
      className={`${styles.statusPill} ${active ? styles.statusPillActive : ""}`}
    >
      <span className={styles.statusDot} />
      {label}
    </span>
  );
}
