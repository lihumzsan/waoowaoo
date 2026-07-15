"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/ui/icons";
import { Comparison, LabButton } from "./comparison-shell";
import styles from "./animation-audit-lab.module.css";

interface InteractionComparisonsProps {
  readonly replayKey: number;
  readonly stress: boolean;
}

export default function InteractionComparisons({
  replayKey,
  stress,
}: InteractionComparisonsProps) {
  return (
    <>
      <DisclosureComparison replayKey={replayKey} stress={stress} />
      <ToastComparison replayKey={replayKey} stress={stress} />
      <DropdownComparison replayKey={replayKey} />
    </>
  );
}

function DisclosureComparison({
  replayKey,
  stress,
}: InteractionComparisonsProps) {
  const t = useTranslations("animationAuditLab");
  const [open, setOpen] = useState(true);
  const [serial, setSerial] = useState(0);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const toggle = useCallback(() => {
    setOpen((value) => !value);
    setSerial((value) => value + 1);
  }, []);

  const runRapidToggle = useCallback(() => {
    clearTimers();
    Array.from({ length: 6 }).forEach((_, index) => {
      const timer = window.setTimeout(() => {
        setOpen((value) => !value);
        setSerial((value) => value + 1);
      }, index * 105);
      timersRef.current.push(timer);
    });
  }, [clearTimers]);

  useEffect(() => {
    toggle();
  }, [replayKey, toggle]);

  useEffect(() => {
    if (!stress) return undefined;
    const interval = window.setInterval(runRapidToggle, 1500);
    return () => window.clearInterval(interval);
  }, [runRapidToggle, stress]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return (
    <Comparison
      title={t("scenarios.disclosure.title")}
      description={t("scenarios.disclosure.description")}
      beforeNote={t("scenarios.disclosure.beforeNote")}
      afterNote={t("scenarios.disclosure.afterNote")}
      actions={
        <LabButton onClick={runRapidToggle}>
          {t("common.rapidToggle")}
        </LabButton>
      }
      before={
        <DisclosureDemo
          open={open}
          serial={serial}
          improved={false}
          onToggle={toggle}
        />
      }
      after={
        <DisclosureDemo
          open={open}
          serial={serial}
          improved
          onToggle={toggle}
        />
      }
    />
  );
}

function DisclosureDemo({
  open,
  serial,
  improved,
  onToggle,
}: {
  readonly open: boolean;
  readonly serial: number;
  readonly improved: boolean;
  readonly onToggle: () => void;
}) {
  const t = useTranslations("animationAuditLab");
  return (
    <div className={styles.disclosureCard}>
      <button
        type="button"
        onClick={onToggle}
        className={styles.disclosureTrigger}
        aria-expanded={open}
      >
        <span>{t("common.details")}</span>
        <AppIcon
          name="chevronDown"
          className={`${styles.disclosureChevron} ${open ? styles.disclosureChevronOpen : ""}`}
        />
      </button>
      {improved ? (
        <div
          className={styles.afterDisclosureViewport}
          data-open={open ? "true" : "false"}
          aria-hidden={!open}
        >
          <DisclosureContent />
        </div>
      ) : (
        <div
          key={`${open ? "open" : "closed"}-${serial}`}
          className={`${styles.beforeDisclosureViewport} ${open ? styles.beforeDisclosureOpen : styles.beforeDisclosureClosed}`}
          aria-hidden={!open}
        >
          <DisclosureContent />
        </div>
      )}
    </div>
  );
}

function DisclosureContent() {
  return (
    <div className={styles.disclosureContent}>
      <span className={styles.contentLine} />
      <span className={`${styles.contentLine} ${styles.contentLineShort}`} />
      <span className={styles.contentLine} />
    </div>
  );
}

function ToastComparison({ replayKey, stress }: InteractionComparisonsProps) {
  const t = useTranslations("animationAuditLab");
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    setCycle((value) => value + 1);
  }, [replayKey]);

  useEffect(() => {
    if (!stress) return undefined;
    const interval = window.setInterval(
      () => setCycle((value) => value + 1),
      1320,
    );
    return () => window.clearInterval(interval);
  }, [stress]);

  return (
    <Comparison
      title={t("scenarios.toast.title")}
      description={t("scenarios.toast.description")}
      beforeNote={t("scenarios.toast.beforeNote")}
      afterNote={t("scenarios.toast.afterNote")}
      actions={
        <LabButton onClick={() => setCycle((value) => value + 1)}>
          {t("common.replay")}
        </LabButton>
      }
      before={<BeforeToast cycle={cycle} />}
      after={<AfterToast cycle={cycle} />}
    />
  );
}

function BeforeToast({ cycle }: { readonly cycle: number }) {
  const t = useTranslations("animationAuditLab");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), 980);
    return () => window.clearTimeout(timeout);
  }, [cycle]);

  return (
    <div className={styles.toastStage}>
      {visible ? (
        <ToastBody
          className={styles.beforeToast}
          message={t("common.toastMessage")}
        />
      ) : null}
    </div>
  );
}

function AfterToast({ cycle }: { readonly cycle: number }) {
  const t = useTranslations("animationAuditLab");
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setMounted(true);
    const frame = window.requestAnimationFrame(() => setVisible(true));
    const startExit = window.setTimeout(() => setVisible(false), 820);
    const unmount = window.setTimeout(() => setMounted(false), 980);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(startExit);
      window.clearTimeout(unmount);
    };
  }, [cycle]);

  return (
    <div className={styles.toastStage}>
      {mounted ? (
        <ToastBody
          className={`${styles.afterToast} ${visible ? styles.afterToastVisible : ""}`}
          message={t("common.toastMessage")}
        />
      ) : null}
    </div>
  );
}

function ToastBody({
  className,
  message,
}: {
  readonly className: string;
  readonly message: string;
}) {
  return (
    <div className={`${styles.toast} ${className}`}>
      <span className={styles.toastIcon}>
        <AppIcon name="check" className="h-4 w-4" />
      </span>
      <span className="text-xs font-semibold text-[var(--glass-text-primary)]">
        {message}
      </span>
    </div>
  );
}

function DropdownComparison({ replayKey }: { readonly replayKey: number }) {
  const t = useTranslations("animationAuditLab");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen((value) => !value);
  }, [replayKey]);

  return (
    <Comparison
      title={t("scenarios.dropdown.title")}
      description={t("scenarios.dropdown.description")}
      beforeNote={t("scenarios.dropdown.beforeNote")}
      afterNote={t("scenarios.dropdown.afterNote")}
      before={
        <DropdownDemo
          open={open}
          improved={false}
          onToggle={() => setOpen((value) => !value)}
        />
      }
      after={
        <DropdownDemo
          open={open}
          improved
          onToggle={() => setOpen((value) => !value)}
        />
      }
    />
  );
}

function DropdownDemo({
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
    <div className={styles.dropdownStage}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={styles.dropdownTrigger}
      >
        <AppIcon name="plus" className="h-4 w-4" />
        {t("common.menuTitle")}
        <AppIcon
          name="chevronDown"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {improved ? (
        <DropdownPanel
          className={`${styles.afterDropdown} ${open ? styles.afterDropdownOpen : ""}`}
          hidden={!open}
        />
      ) : open ? (
        <DropdownPanel className="animate-in fade-in-0 zoom-in-95 duration-150" />
      ) : null}
    </div>
  );
}

function DropdownPanel({
  className,
  hidden,
}: {
  readonly className: string;
  readonly hidden?: boolean;
}) {
  const t = useTranslations("animationAuditLab");
  const items = [
    t("common.menuCharacter"),
    t("common.menuLocation"),
    t("common.menuProp"),
  ];
  return (
    <div
      className={`${styles.dropdownPanel} ${className}`}
      aria-hidden={hidden}
    >
      {items.map((item) => (
        <button key={item} type="button" className={styles.dropdownItem}>
          {item}
        </button>
      ))}
    </div>
  );
}
