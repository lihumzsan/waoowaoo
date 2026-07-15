"use client";

import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/ui/icons";
import { Comparison } from "./comparison-shell";
import styles from "./animation-audit-lab.module.css";

export default function AccessibilityComparison() {
  const t = useTranslations("animationAuditLab");
  return (
    <Comparison
      title={t("scenarios.reduced.title")}
      description={t("scenarios.reduced.description")}
      beforeNote={t("scenarios.reduced.beforeNote")}
      afterNote={t("scenarios.reduced.afterNote")}
      before={<ReducedMotionDemo improved={false} />}
      after={<ReducedMotionDemo improved />}
    />
  );
}

function ReducedMotionDemo({ improved }: { readonly improved: boolean }) {
  const t = useTranslations("animationAuditLab");
  return (
    <div className={styles.motionPreferenceStage}>
      <div className={styles.motionRail}>
        <div
          className={`${styles.motionOrb} ${improved ? styles.afterAccessibleMotion : styles.beforeAccessibleMotion}`}
        >
          <AppIcon name="sparklesAlt" className="h-4 w-4" />
        </div>
      </div>
      <div
        className={`${styles.preferenceStatus} ${improved ? styles.afterPreferenceStatus : ""}`}
      >
        <span className={styles.preferenceDot} />
        <span>{t("common.ready")}</span>
      </div>
    </div>
  );
}
