"use client";

import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceAssistantComposer } from "@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantComposer";
import { WorkspaceAssistantPlanCard } from "@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantPlanCard";
import {
  ConfirmationActionCard,
  useWorkspaceAssistantMessagePartComponents,
  WorkspaceAssistantThreadMessage,
} from "@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantRenderers";
import { WorkspaceAssistantRunningSurfaceProvider } from "@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantReasoning";
import { WorkspaceAssistantRepeatedToolCallGroupProvider } from "@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantToolCall";
import { WorkspaceAssistantWorkspaceLinkProvider } from "@/features/project-workspace/components/workspace-assistant/workspace-assistant-workspace-link";
import { buildAssistantUiLabPlan } from "@/features/assistant-ui-lab/conversation";

type AssistantContentPart = Exclude<ThreadMessageLike["content"], string>[number];
type ConversationTranslator = ReturnType<typeof useTranslations<"assistantUiLab.conversation">>;

function buildMessages(stage: number, t: ConversationTranslator): ThreadMessageLike[] {
  const attachmentText = t("attachmentBody");
  const messages: ThreadMessageLike[] = [
    {
      id: "lab-user",
      role: "user",
      createdAt: new Date(0),
      content: [{ type: "text", text: t("user") }],
      metadata: {
        custom: {
          projectAssistantTextAttachments: [{
            id: "lab-attachment",
            kind: "markdown",
            fileName: t("attachment"),
            mimeType: "text/markdown",
            sizeBytes: attachmentText.length,
            checksum: "assistant-ui-lab-reference",
            charCount: attachmentText.length,
            normalizedText: attachmentText,
          }],
        },
      },
    },
  ];
  if (stage < 1) return messages;

  const content: AssistantContentPart[] = [
    { type: "reasoning", text: t("reasoning") },
  ];

  if (stage >= 3) {
    content.push({
      type: "tool-call",
      toolName: "web_search",
      toolCallId: "lab-search",
      args: { query: t("searchQuery") },
      argsText: JSON.stringify({ query: t("searchQuery") }),
      result: stage > 3 ? {
        results: [
          {
            type: "search_result",
            url: "https://www.assistant-ui.com/",
            title: "assistant-ui",
            source_domain: "assistant-ui.com",
          },
          {
            type: "search_result",
            url: "https://ai-sdk.dev/elements/overview",
            title: "AI Elements",
            source_domain: "ai-sdk.dev",
          },
        ],
      } : undefined,
    });
  }

  if (stage >= 4) {
    content.push({
      type: "tool-call",
      toolName: "shell",
      toolCallId: "lab-command",
      args: { command: "npm run typecheck" },
      argsText: JSON.stringify({ command: "npm run typecheck" }),
      result: stage > 4 ? { ok: true, output: t("commandResult") } : undefined,
    });
  }

  if (stage >= 5) {
    content.push({
      type: "tool-call",
      toolName: "file_change",
      toolCallId: "lab-file-change",
      args: { file: "WorkspaceAssistantRenderers.tsx" },
      argsText: JSON.stringify({ file: "WorkspaceAssistantRenderers.tsx" }),
      result: stage > 5 ? { ok: true, summary: t("fileResult") } : undefined,
    });
  }

  if (stage >= 6) {
    content.push(
      {
        type: "data-assistant-context-compacted",
        data: {
          status: stage === 6 ? "running" : "completed",
          replacedItemCount: stage === 6 ? 0 : 18,
        },
      },
      {
        type: "data-assistant-runtime-goal",
        data: {
          goal: {
            objective: t("goalObjective"),
            status: "active",
            tokensUsed: 8420,
            timeUsedSeconds: 96,
          },
        },
      },
      {
        type: "data-assistant-runtime-skills",
        data: {
          changed: false,
          skills: [{
            name: "browser-qa",
            description: t("skillDescription"),
            enabled: false,
            scope: "repo",
          }],
          errorCount: 1,
        },
      },
    );
  }

  if (stage >= 8) {
    content.push(
      {
        type: "tool-call",
        toolName: "shell",
        toolCallId: "lab-failed-command",
        args: { command: "npm run build:verify" },
        argsText: JSON.stringify({ command: "npm run build:verify" }),
        result: {
          ok: false,
          error: { code: "INTERNAL_ERROR" },
        },
        isError: true,
      },
      {
        type: "tool-call",
        toolName: "shell",
        toolCallId: "lab-retry-command",
        args: { command: "npm run build:verify" },
        argsText: JSON.stringify({ command: "npm run build:verify" }),
        result: stage > 8 ? { ok: true, output: t("retryResult") } : undefined,
      },
    );
  }

  if (stage >= 9) {
    content.push({ type: "text", text: t("final") });
  }

  messages.push({
    id: "lab-assistant",
    role: "assistant",
    createdAt: new Date(1),
    content,
    status: stage >= 9
      ? { type: "complete", reason: "stop" }
      : stage === 7
        ? { type: "requires-action", reason: "interrupt" }
        : { type: "running" },
    metadata: { custom: {} },
  });
  return messages;
}

export function AssistantUiDemo({ stage }: { stage: number }) {
  const t = useTranslations("assistantUiLab.conversation");
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messages = useMemo(() => buildMessages(stage, t), [stage, t]);
  const partComponents = useWorkspaceAssistantMessagePartComponents();
  const active = stage > 0 && stage < 9;
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: active,
    convertMessage: (message) => message,
    onNew: async (_message: AppendMessage) => {
      void _message;
    },
  });
  const plan = useMemo(
    () => buildAssistantUiLabPlan({
      step1: t("planStep1"),
      step2: t("planStep2"),
      step3: t("planStep3"),
    }, stage),
    [stage, t],
  );

  return (
    <TooltipProvider>
      <WorkspaceAssistantRepeatedToolCallGroupProvider messages={[]}>
        <WorkspaceAssistantWorkspaceLinkProvider openWorkspacePath={() => {}}>
          <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root className="glass-tower relative flex h-full min-h-0 flex-col bg-white">
              <ThreadPrimitive.Viewport
                autoScroll
                className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-4 pt-8"
              >
                <WorkspaceAssistantRunningSurfaceProvider activeTurn={active}>
                  <div className="mx-auto min-w-0 w-full max-w-[40rem]">
                    <div className="space-y-6">
                      <ThreadPrimitive.Messages>
                        {() => (
                          <WorkspaceAssistantThreadMessage
                            messagePartComponents={partComponents}
                          />
                        )}
                      </ThreadPrimitive.Messages>
                      {stage === 7 ? (
                        <ConfirmationActionCard
                          members={[{
                            operationId: "item/permissions/requestApproval",
                            title: "npm install",
                            operationPlan: null,
                            details: [t("approvalScope")],
                          }]}
                          subtitle={t("approvalDescription")}
                          onConfirm={async () => {}}
                          onCancel={async () => {}}
                        />
                      ) : null}
                    </div>
                  </div>
                </WorkspaceAssistantRunningSurfaceProvider>
              </ThreadPrimitive.Viewport>
              <div className="mx-4 mb-2 shrink-0">
                <div className="relative">
                  {stage >= 2 && stage < 9 ? (
                    <WorkspaceAssistantPlanCard plan={plan} isRunActive={active} />
                  ) : null}
                  <WorkspaceAssistantComposer
                    value={draft}
                    textareaRef={textareaRef}
                    selection={null}
                    error={null}
                    pending={active}
                    canStopReply={active}
                    attachments={[]}
                    onChange={setDraft}
                    onSubmit={async () => setDraft("")}
                    onStopReply={async () => {}}
                    onAttachClick={() => {}}
                    onRemoveAttachment={() => {}}
                    onClearSelection={() => {}}
                  />
                </div>
              </div>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        </WorkspaceAssistantWorkspaceLinkProvider>
      </WorkspaceAssistantRepeatedToolCallGroupProvider>
    </TooltipProvider>
  );
}
