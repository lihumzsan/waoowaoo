"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import ApprovalCard from "@/components/beautiful-ui/ApprovalCard";
import ChatComposer from "@/components/beautiful-ui/ChatComposer";
import StreamingText from "@/components/beautiful-ui/StreamingText";
import ThinkingState from "@/components/beautiful-ui/ThinkingState";
import ToolChips, { type ToolChipRow } from "@/components/beautiful-ui/ToolChips";
import { RuntimeStateCards } from "@/features/assistant-ui-lab/RuntimeStateCards";

export function BeautifulUiDemo({ stage }: { stage: number }) {
  const t = useTranslations("assistantUiLab.conversation");
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolRows = useMemo<ToolChipRow[]>(() => [
    {
      icon: "read",
      label: t("searchTitle"),
      chip: t("searchQuery"),
      mono: false,
      detailMono: false,
      detail: [{ text: t("searchResult") }],
    },
    {
      icon: "run",
      label: t("commandTitle"),
      chip: "npm run typecheck",
      mono: true,
      detailMono: true,
      detail: [{ text: t("commandResult") }],
    },
    {
      icon: "write",
      label: t("fileTitle"),
      chip: "WorkspaceAssistantRenderers.tsx",
      mono: true,
      detailMono: false,
      detail: [{ text: t("fileResult"), tone: "add" }],
    },
    {
      icon: "run",
      label: t("failedCommandTitle"),
      chip: "npm run build:verify",
      mono: true,
      detailMono: false,
      detail: [{ text: t("failedCommandResult") }],
    },
    {
      icon: "run",
      label: t("retryCommandTitle"),
      chip: "npm run build:verify",
      mono: true,
      detailMono: false,
      detail: [{ text: t("retryResult") }],
    },
  ], [t]);
  const visibleToolCount = stage < 3
    ? 0
    : stage < 4
      ? 1
      : stage < 5
        ? 2
        : stage < 8
          ? 3
          : stage < 9
            ? 5
            : 5;

  useEffect(() => {
    const target = scrollRef.current;
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
  }, [stage]);

  return (
    <div className="beautiful-ui-demo flex h-full min-h-0 flex-col bg-canvas">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-8">
        <div className="mx-auto flex w-full max-w-95 flex-col gap-6">
          <div className="ml-auto max-w-[88%] rounded-xl bg-field px-3 py-2.5 text-[17px] leading-7 text-ink shadow-hairline">
            <p>{t("user")}</p>
            <span className="mt-2 inline-flex h-7 items-center rounded-chip bg-surface px-2 font-mono text-[11.5px] text-ink-2 shadow-btn">
              {t("attachment")}
            </span>
          </div>

          {stage >= 1 ? (
            <ThinkingState
              variant="Reasoning"
              data={{
                active: t("thinkingActive"),
                done: t("thinkingDone"),
                rows: [{ primary: t("reasoning") }],
              }}
            />
          ) : null}

          {stage >= 3 ? (
            <ToolChips
              rows={toolRows}
              diffs={[]}
              revealCount={visibleToolCount}
              summary={t("toolCount", { count: visibleToolCount })}
              moreLabel=""
            />
          ) : null}

          {stage >= 6 ? (
            <RuntimeStateCards
              stage={stage}
              goal={t("goalObjective")}
              skillDescription={t("skillDescription")}
            />
          ) : null}

          {stage === 7 ? (
            <ApprovalCard
              questions={[{
                q: t("approvalDescription"),
                type: "radio",
                options: [t("approve"), t("reject")],
              }]}
              copy={{
                open: t("approvalOpen"),
                sent: t("approved"),
                reset: t("approvalReset"),
                dismiss: t("approvalDismiss"),
                customPlaceholder: t("approvalCustom"),
                customAnswer: t("approvalCustomLabel"),
                previous: t("approvalPrevious"),
                next: t("approvalNext"),
                goTo: (index) => t("approvalGoTo", { index }),
                send: t("approvalSend"),
              }}
            />
          ) : null}

          {stage >= 9 ? (
            <StreamingText
              text={t("final")}
              sourceCountLabel={t("sources")}
              followUpsLabel={t("followUps")}
              followUps={[t("followUp1"), t("followUp2")]}
              actionLabel={t("action")}
              sources={[
                {
                  name: "assistant-ui",
                  domain: "assistant-ui.com",
                  href: "https://www.assistant-ui.com/",
                  image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%231f2124'/%3E%3Cpath d='M18 32h28M32 18v28' stroke='%23fff' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E",
                },
                {
                  name: "AI Elements",
                  domain: "ai-sdk.dev",
                  href: "https://ai-sdk.dev/elements/overview",
                  image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%230285ff'/%3E%3Cpath d='M16 42 28 20l8 16 12-14' fill='none' stroke='%23fff' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
                },
              ]}
            />
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-canvas px-4 pb-3 pt-2">
        {stage >= 2 && stage < 9 ? (
          <div className="mx-auto mb-2 max-w-95">
            <ToolChips
              rows={[
                { icon: "think", label: t("planStep1"), chip: t("planStatusDone"), mono: false, detailMono: false, detail: [] },
                { icon: "think", label: t("planStep2"), chip: stage < 7 ? t("planStatusRunning") : t("planStatusDone"), mono: false, detailMono: false, detail: [] },
                { icon: "think", label: t("planStep3"), chip: stage < 7 ? t("planStatusPending") : t("planStatusRunning"), mono: false, detailMono: false, detail: [] },
              ]}
              diffs={[]}
              revealCount={0}
              summary={t("planProgress", { completed: stage < 4 ? 0 : stage < 7 ? 1 : 2, total: 3 })}
              moreLabel=""
            />
          </div>
        ) : null}
        <ChatComposer
          composerOnly
          copy={{
            tabs: [t("tabConversation"), t("tabEvents")],
            initialPrompt: t("user"),
            first: { label: t("sectionAnalysis"), sub: t("thinkingDone"), time: "4s", body: t("sectionMapped") },
            second: { label: t("sectionInventory"), sub: t("taskDone"), time: "2s", body: t("sectionReady") },
            durationJoiner: t("durationJoiner"),
            action: t("action"),
            placeholder: t("composer"),
            inputLabel: t("composer"),
            send: t("send"),
          }}
        />
      </div>
    </div>
  );
}
