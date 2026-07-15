"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/ui/icons";
import { Comparison } from "./comparison-shell";
import styles from "./animation-audit-lab.module.css";

export default function PurposeComparisons() {
  const t = useTranslations("animationAuditLab");
  const [beforeClicks, setBeforeClicks] = useState(0);
  const [afterClicks, setAfterClicks] = useState(0);

  return (
    <Comparison
      title={t("scenarios.hoverPress.title")}
      description={t("scenarios.hoverPress.description")}
      beforeNote={t("scenarios.hoverPress.beforeNote")}
      afterNote={t("scenarios.hoverPress.afterNote")}
      before={
        <ProjectCard
          className={styles.beforeHoverCard}
          buttonClassName={styles.beforePressButton}
          clicks={beforeClicks}
          onClick={() => setBeforeClicks((count) => count + 1)}
        />
      }
      after={
        <ProjectCard
          className={styles.afterHoverCard}
          buttonClassName={styles.afterPressButton}
          clicks={afterClicks}
          onClick={() => setAfterClicks((count) => count + 1)}
        />
      }
    />
  );
}

function ProjectCard({
  className,
  buttonClassName,
  clicks,
  onClick,
}: {
  readonly className: string;
  readonly buttonClassName: string;
  readonly clicks: number;
  readonly onClick: () => void;
}) {
  const t = useTranslations("animationAuditLab");

  return (
    <div className={`${styles.projectCard} ${className}`}>
      <div className={styles.projectArtwork}>
        <div className={styles.projectGlow} />
        <AppIcon
          name="clapperboard"
          className="relative z-10 h-6 w-6 text-white"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-[var(--glass-text-primary)]">
          {t("common.projectName")}
        </div>
        <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
          {t("common.episodeCount")}
        </div>
      </div>
      <button
        type="button"
        aria-label={t("common.send")}
        onClick={onClick}
        className={`${styles.roundAction} ${buttonClassName}`}
      >
        <AppIcon name="arrowRight" className="h-4 w-4" />
      </button>
      <span className={styles.clickMetric}>
        {t("common.clicks", { count: clicks })}
      </span>
    </div>
  );
}
