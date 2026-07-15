import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./animation-audit-lab.module.css";

export function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="scroll-mt-24">
      <div className="mb-5 max-w-3xl">
        <h2 className="text-2xl font-bold tracking-[-0.03em] text-[var(--glass-text-primary)] md:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--glass-text-secondary)] md:text-base">
          {description}
        </p>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function Comparison({
  title,
  description,
  beforeNote,
  afterNote,
  before,
  after,
  actions,
}: {
  readonly title: string;
  readonly description: string;
  readonly beforeNote: string;
  readonly afterNote: string;
  readonly before: ReactNode;
  readonly after: ReactNode;
  readonly actions?: ReactNode;
}) {
  const t = useTranslations("animationAuditLab.legend");

  return (
    <article className={styles.comparison}>
      <header className="flex flex-col gap-4 border-b border-black/5 px-5 py-5 md:flex-row md:items-start md:justify-between md:px-6">
        <div className="max-w-3xl">
          <h3 className="text-lg font-bold tracking-[-0.02em] text-[var(--glass-text-primary)] md:text-xl">
            {title}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-[var(--glass-text-secondary)]">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="grid md:grid-cols-2">
        <ComparisonSide
          label={t("before")}
          shortLabel={t("beforeShort")}
          note={beforeNote}
          tone="before"
        >
          {before}
        </ComparisonSide>
        <ComparisonSide
          label={t("after")}
          shortLabel={t("afterShort")}
          note={afterNote}
          tone="after"
        >
          {after}
        </ComparisonSide>
      </div>
    </article>
  );
}

function ComparisonSide({
  label,
  shortLabel,
  note,
  tone,
  children,
}: {
  readonly label: string;
  readonly shortLabel: string;
  readonly note: string;
  readonly tone: "before" | "after";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={`${styles.side} ${tone === "before" ? styles.beforeSide : styles.afterSide}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`${styles.versionBadge} ${tone === "before" ? styles.beforeBadge : styles.afterBadge}`}
          >
            {shortLabel}
          </span>
          <span className="text-sm font-semibold text-[var(--glass-text-primary)]">
            {label}
          </span>
        </div>
      </div>
      <div className={styles.stage}>{children}</div>
      <code className={styles.note}>{note}</code>
    </div>
  );
}

export function LabButton({
  children,
  onClick,
  pressed,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="glass-btn-base glass-btn-secondary min-h-9 rounded-xl px-3 py-2 text-xs font-semibold"
    >
      {children}
    </button>
  );
}
