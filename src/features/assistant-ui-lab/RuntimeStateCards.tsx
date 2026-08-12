"use client";

import {
  AssistantContextCompactedDataCard,
  AssistantRuntimeGoalDataCard,
  AssistantRuntimeSkillsDataCard,
} from "@/features/project-workspace/components/workspace-assistant/WorkspaceAssistantNotices";

export function RuntimeStateCards({
  stage,
  goal,
  skillDescription,
}: {
  stage: number;
  goal: string;
  skillDescription: string;
}) {
  return (
    <div className="space-y-3">
      <AssistantContextCompactedDataCard
        type="data"
        name="assistant-context-compacted"
        status={{ type: "complete" }}
        data={{
          status: stage === 6 ? "running" : "completed",
          replacedItemCount: stage === 6 ? 0 : 18,
        }}
      />
      <AssistantRuntimeGoalDataCard
        type="data"
        name="assistant-runtime-goal"
        status={{ type: "complete" }}
        data={{
          goal: {
            objective: goal,
            status: "active",
            tokensUsed: 8420,
            timeUsedSeconds: 96,
          },
        }}
      />
      <AssistantRuntimeSkillsDataCard
        type="data"
        name="assistant-runtime-skills"
        status={{ type: "complete" }}
        data={{
          changed: false,
          skills: [{
            name: "browser-qa",
            description: skillDescription,
            enabled: false,
            scope: "repo",
          }],
          errorCount: 1,
        }}
      />
    </div>
  );
}
