"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { PaperclipIcon } from "@/components/ui/icons";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, ToolHeader } from "@/components/ai-elements/tool";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { Badge } from "@/components/ui/badge";
import { RuntimeStateCards } from "@/features/assistant-ui-lab/RuntimeStateCards";
import { buildAssistantUiLabPlan } from "@/features/assistant-ui-lab/conversation";

type ApprovalDecision = "approved" | "rejected" | null;

export function AiElementsDemo({ stage }: { stage: number }) {
  const t = useTranslations("assistantUiLab.conversation");
  const [decision, setDecision] = useState<ApprovalDecision>(null);
  const active = stage > 0 && stage < 9;
  const plan = useMemo(
    () => buildAssistantUiLabPlan({
      step1: t("planStep1"),
      step2: t("planStep2"),
      step3: t("planStep3"),
    }, stage),
    [stage, t],
  );

  useEffect(() => {
    if (stage < 7) setDecision(null);
  }, [stage]);

  const effectiveDecision = decision ?? (stage > 7 ? "approved" : null);
  const approvalState = effectiveDecision ? "approval-responded" : "approval-requested";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-6 px-5 pb-6 pt-8">
          <Message from="user">
            <MessageContent className="text-[17px] leading-7">
              <p>{t("user")}</p>
              <Badge className="mt-2 w-fit gap-1.5" variant="secondary">
                <PaperclipIcon className="size-3" />
                {t("attachment")}
              </Badge>
            </MessageContent>
          </Message>

          {stage >= 1 ? (
            <Message from="assistant">
              <MessageContent className="w-full text-[17px] leading-7">
                <Reasoning defaultOpen isStreaming={stage === 1}>
                  <ReasoningTrigger
                    getThinkingMessage={(isStreaming) =>
                      isStreaming ? t("thinkingActive") : t("thinkingDone")
                    }
                  />
                  <ReasoningContent>{t("reasoning")}</ReasoningContent>
                </Reasoning>
              </MessageContent>
            </Message>
          ) : null}

          {stage >= 3 ? (
            <Message from="assistant">
              <MessageContent className="w-full">
                <Tool>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName="web_search"
                    title={t("searchTitle")}
                    state={stage === 3 ? "input-available" : "output-available"}
                  />
                </Tool>
                {stage > 3 ? (
                  <Sources className="mt-2">
                    <SourcesTrigger count={2}>{t("sources")}</SourcesTrigger>
                    <SourcesContent>
                      <Source href="https://www.assistant-ui.com/" title="assistant-ui" />
                      <Source href="https://ai-sdk.dev/elements/overview" title="AI Elements" />
                    </SourcesContent>
                  </Sources>
                ) : null}
              </MessageContent>
            </Message>
          ) : null}

          {stage >= 4 ? (
            <Message from="assistant">
              <MessageContent className="w-full">
                <Tool>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName="shell"
                    title={t("commandTitle")}
                    state={stage === 4 ? "input-available" : "output-available"}
                  />
                </Tool>
              </MessageContent>
            </Message>
          ) : null}

          {stage >= 5 ? (
            <Message from="assistant">
              <MessageContent className="w-full">
                <Tool>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName="file_change"
                    title={t("fileTitle")}
                    state={stage === 5 ? "input-available" : "output-available"}
                  />
                </Tool>
              </MessageContent>
            </Message>
          ) : null}

          {stage >= 6 ? (
            <Message from="assistant">
              <MessageContent className="w-full">
                <RuntimeStateCards
                  stage={stage}
                  goal={t("goalObjective")}
                  skillDescription={t("skillDescription")}
                />
              </MessageContent>
            </Message>
          ) : null}

          {stage === 7 ? (
            <Message from="assistant">
              <MessageContent className="w-full">
                <Confirmation
                  approval={effectiveDecision
                    ? { id: "lab-approval", approved: effectiveDecision === "approved" }
                    : { id: "lab-approval" }}
                  state={approvalState}
                >
                  <ConfirmationRequest>
                    <ConfirmationTitle>
                      <strong>{t("approvalTitle")}</strong><br />
                      {t("approvalDescription")}<br />
                      <span className="text-muted-foreground">{t("approvalScope")}</span>
                    </ConfirmationTitle>
                    <ConfirmationActions>
                      <ConfirmationAction variant="outline" onClick={() => setDecision("rejected")}>
                        {t("reject")}
                      </ConfirmationAction>
                      <ConfirmationAction onClick={() => setDecision("approved")}>
                        {t("approve")}
                      </ConfirmationAction>
                    </ConfirmationActions>
                  </ConfirmationRequest>
                  <ConfirmationAccepted>{t("approved")}</ConfirmationAccepted>
                  <ConfirmationRejected>{t("rejected")}</ConfirmationRejected>
                </Confirmation>
              </MessageContent>
            </Message>
          ) : null}

          {stage >= 8 ? (
            <Message from="assistant">
              <MessageContent className="w-full space-y-2">
                <Tool>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName="shell"
                    title={t("failedCommandTitle")}
                    state="output-error"
                  />
                </Tool>
                <Tool>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName="shell"
                    title={t("retryCommandTitle")}
                    state={stage === 8 ? "input-available" : "output-available"}
                  />
                </Tool>
              </MessageContent>
            </Message>
          ) : null}

          {stage >= 9 ? (
            <Message from="assistant">
              <MessageContent className="w-full text-[17px] leading-7">
                <MessageResponse>{t("final")}</MessageResponse>
              </MessageContent>
            </Message>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t bg-background px-4 pb-3 pt-2">
        {stage >= 2 && stage < 9 ? (
          <Plan className="mb-2" isStreaming={active}>
            <PlanHeader className="py-3">
              <div className="space-y-1">
                <PlanTitle>{t("planProgress", {
                  completed: plan.plan.filter((item) => item.status === "completed").length,
                  total: plan.plan.length,
                })}</PlanTitle>
                <PlanDescription>{t("planDescription")}</PlanDescription>
              </div>
              <PlanTrigger aria-label={t("planTitle")} />
            </PlanHeader>
            <PlanContent className="space-y-2 pb-3 text-sm text-muted-foreground">
              {plan.plan.map((item) => <p key={item.step}>{item.step}</p>)}
            </PlanContent>
          </Plan>
        ) : null}
        <PromptInput onSubmit={() => {}}>
          <PromptInputTextarea placeholder={t("composer")} />
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit aria-label={t("send")} status={active ? "streaming" : undefined} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
