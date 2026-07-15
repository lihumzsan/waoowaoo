"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/ui/icons";
import { Comparison } from "./comparison-shell";
import styles from "./animation-audit-lab.module.css";

interface PerformanceComparisonsProps {
  readonly replayKey: number;
  readonly stress: boolean;
}

export default function PerformanceComparisons({
  replayKey,
  stress,
}: PerformanceComparisonsProps) {
  return (
    <>
      <TextareaComparison key={`textarea-${replayKey}`} />
      <SegmentedComparison replayKey={replayKey} stress={stress} />
      <ProgressComparison replayKey={replayKey} stress={stress} />
      <LoadingNodesComparison replayKey={replayKey} />
    </>
  );
}

function TextareaComparison() {
  const t = useTranslations("animationAuditLab");
  const beforeRef = useRef<HTMLTextAreaElement>(null);
  const afterRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [beforeOps, setBeforeOps] = useState(0);
  const [afterOps, setAfterOps] = useState(0);

  useLayoutEffect(() => {
    const before = beforeRef.current;
    const after = afterRef.current;
    if (!before || !after) return undefined;

    const oldHeight = before.offsetHeight;
    before.style.transition = "none";
    before.style.height = "auto";
    const beforeTarget = before.scrollHeight;
    before.style.height = `${oldHeight}px`;
    const frame = window.requestAnimationFrame(() => {
      before.style.transition = "height 200ms ease-out";
      before.style.height = `${beforeTarget}px`;
    });
    setBeforeOps((count) => count + 5);

    after.style.height = "auto";
    const afterTarget = after.scrollHeight;
    after.style.height = `${afterTarget}px`;
    setAfterOps((count) => count + 3);

    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  const updateValue = (nextValue: string) => setValue(nextValue);

  return (
    <Comparison
      title={t("scenarios.textarea.title")}
      description={t("scenarios.textarea.description")}
      beforeNote={t("scenarios.textarea.beforeNote")}
      afterNote={t("scenarios.textarea.afterNote")}
      before={
        <TextareaDemo
          textareaRef={beforeRef}
          value={value}
          label={t("legend.before")}
          placeholder={t("scenarios.textarea.placeholder")}
          metric={t("common.layoutOps", { count: beforeOps })}
          onChange={updateValue}
        />
      }
      after={
        <TextareaDemo
          textareaRef={afterRef}
          value={value}
          label={t("legend.after")}
          placeholder={t("scenarios.textarea.placeholder")}
          metric={t("common.layoutOps", { count: afterOps })}
          onChange={updateValue}
        />
      }
    />
  );
}

function TextareaDemo({
  textareaRef,
  value,
  label,
  placeholder,
  metric,
  onChange,
}: {
  readonly textareaRef: Ref<HTMLTextAreaElement>;
  readonly value: string;
  readonly label: string;
  readonly placeholder: string;
  readonly metric: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="w-full">
      <textarea
        ref={textareaRef}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        className={styles.demoTextarea}
      />
      <div className={styles.metric}>{metric}</div>
    </div>
  );
}

function SegmentedComparison({
  replayKey,
  stress,
}: PerformanceComparisonsProps) {
  const t = useTranslations("animationAuditLab");
  const options = [
    t("scenarios.segmented.optionA"),
    t("scenarios.segmented.optionB"),
    t("scenarios.segmented.optionC"),
  ];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const beforeRef = useRef<HTMLDivElement>(null);
  const [beforeIndicator, setBeforeIndicator] = useState({ left: 3, width: 0 });

  useLayoutEffect(() => {
    const activeButton =
      beforeRef.current?.querySelectorAll<HTMLButtonElement>("button")[
        selectedIndex
      ];
    if (!activeButton) return;
    setBeforeIndicator({
      left: activeButton.offsetLeft,
      width: activeButton.offsetWidth,
    });
  }, [selectedIndex]);

  useEffect(() => {
    setSelectedIndex((index) => (index + 1) % options.length);
  }, [replayKey, options.length]);

  useEffect(() => {
    if (!stress) return undefined;
    const interval = window.setInterval(() => {
      setSelectedIndex((index) => (index + 1) % options.length);
    }, 360);
    return () => window.clearInterval(interval);
  }, [stress, options.length]);

  const afterStyle: CSSProperties & { "--segment-index": number } = {
    "--segment-index": selectedIndex,
  };

  return (
    <Comparison
      title={t("scenarios.segmented.title")}
      description={t("scenarios.segmented.description")}
      beforeNote={t("scenarios.segmented.beforeNote")}
      afterNote={t("scenarios.segmented.afterNote")}
      before={
        <div ref={beforeRef} className={styles.segmented}>
          <div
            className={styles.beforeSegmentIndicator}
            style={{ left: beforeIndicator.left, width: beforeIndicator.width }}
          />
          <SegmentButtons
            options={options}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        </div>
      }
      after={
        <div className={styles.segmented} style={afterStyle}>
          <div className={styles.afterSegmentIndicator} />
          <SegmentButtons
            options={options}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        </div>
      }
    />
  );
}

function SegmentButtons({
  options,
  selectedIndex,
  onSelect,
}: {
  readonly options: readonly string[];
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
}) {
  return options.map((option, index) => (
    <button
      key={option}
      type="button"
      aria-pressed={selectedIndex === index}
      onClick={() => onSelect(index)}
      className={`${styles.segmentButton} ${selectedIndex === index ? styles.segmentButtonSelected : ""}`}
    >
      {option}
    </button>
  ));
}

function ProgressComparison({
  replayKey,
  stress,
}: PerformanceComparisonsProps) {
  const t = useTranslations("animationAuditLab");
  const [progress, setProgress] = useState(24);

  useEffect(() => {
    setProgress((value) => (value > 50 ? 24 : 86));
  }, [replayKey]);

  useEffect(() => {
    if (!stress) return undefined;
    const interval = window.setInterval(() => {
      setProgress((value) => (value > 50 ? 18 : 92));
    }, 760);
    return () => window.clearInterval(interval);
  }, [stress]);

  return (
    <Comparison
      title={t("scenarios.progress.title")}
      description={t("scenarios.progress.description")}
      beforeNote={t("scenarios.progress.beforeNote")}
      afterNote={t("scenarios.progress.afterNote")}
      before={<ProgressDemo progress={progress} improved={false} />}
      after={<ProgressDemo progress={progress} improved />}
    />
  );
}

function ProgressDemo({
  progress,
  improved,
}: {
  readonly progress: number;
  readonly improved: boolean;
}) {
  const t = useTranslations("animationAuditLab");
  return (
    <div className="w-full space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--glass-text-secondary)]">
          <span>{t("common.processing")}</span>
          <span className="tabular-nums">
            {t("common.progress", { percent: progress })}
          </span>
        </div>
        <div className={styles.progressTrack}>
          <div
            className={
              improved ? styles.afterProgressFill : styles.beforeProgressFill
            }
            style={
              improved
                ? { transform: `scaleX(${progress / 100})` }
                : { width: `${progress}%` }
            }
          />
        </div>
      </div>
      <div className={styles.indeterminateTrack}>
        <div
          className={
            improved ? styles.afterIndeterminate : styles.beforeIndeterminate
          }
        />
      </div>
    </div>
  );
}

function LoadingNodesComparison({ replayKey }: { readonly replayKey: number }) {
  const t = useTranslations("animationAuditLab");
  const nodeNames = [
    t("common.nodePlanning"),
    t("common.nodeAssets"),
    t("common.nodeVideo"),
    t("common.processing"),
  ];

  return (
    <Comparison
      title={t("scenarios.loadingNodes.title")}
      description={t("scenarios.loadingNodes.description")}
      beforeNote={t("scenarios.loadingNodes.beforeNote")}
      afterNote={t("scenarios.loadingNodes.afterNote")}
      before={
        <NodeGrid
          key={`before-${replayKey}`}
          names={nodeNames}
          improved={false}
        />
      }
      after={<NodeGrid key={`after-${replayKey}`} names={nodeNames} improved />}
    />
  );
}

function NodeGrid({
  names,
  improved,
}: {
  readonly names: readonly string[];
  readonly improved: boolean;
}) {
  return (
    <div className={styles.nodeGrid}>
      {names.map((name, index) => (
        <div
          key={`${name}-${index}`}
          className={`${styles.loadingNode} ${improved ? styles.afterLoadingNode : styles.beforeLoadingNode}`}
        >
          <span className={styles.nodeStatusDot} />
          <span className="relative z-10 truncate text-xs font-semibold text-[var(--glass-text-primary)]">
            {name}
          </span>
          <AppIcon
            name="loader"
            className="relative z-10 ml-auto h-3.5 w-3.5 animate-spin text-[var(--glass-tone-info-fg)]"
          />
        </div>
      ))}
    </div>
  );
}
