"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { PauseIcon, PlayIcon, RotateCcwIcon } from "@/components/ui/icons";
import { AiElementsDemo } from "@/features/assistant-ui-lab/AiElementsDemo";
import { BeautifulUiDemo } from "@/features/assistant-ui-lab/BeautifulUiDemo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ASSISTANT_UI_LAB_STAGE_KEYS } from "@/features/assistant-ui-lab/conversation";
import "./beautiful-ui-lab.css";

const AssistantUiDemo = dynamic(
  () => import("@/features/assistant-ui-lab/AssistantUiDemo").then((module) => module.AssistantUiDemo),
  { ssr: false },
);

const SPEEDS = [0.65, 1, 1.6] as const;

function ComparisonColumn({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="h-[calc(100vh-13rem)] min-h-[680px] min-w-[410px] gap-0 overflow-hidden py-0 shadow-sm">
      <CardHeader className="border-b py-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        {children}
      </CardContent>
    </Card>
  );
}

export function AssistantUiLab() {
  const t = useTranslations("assistantUiLab");
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [cycle, setCycle] = useState(0);
  const speed = SPEEDS[speedIndex];

  useEffect(() => {
    if (!playing || stage >= ASSISTANT_UI_LAB_STAGE_KEYS.length - 1) return;
    const timer = window.setTimeout(
      () => setStage((current) => Math.min(ASSISTANT_UI_LAB_STAGE_KEYS.length - 1, current + 1)),
      2200 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [playing, speed, stage]);

  useEffect(() => {
    if (stage === ASSISTANT_UI_LAB_STAGE_KEYS.length - 1) setPlaying(false);
  }, [stage]);

  const replay = () => {
    setStage(0);
    setCycle((current) => current + 1);
    setPlaying(true);
  };

  return (
    <TooltipProvider>
    <main className="min-h-screen bg-muted/30 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {t("controls.progress", { current: stage + 1, total: ASSISTANT_UI_LAB_STAGE_KEYS.length })}
            </Badge>
            <Badge variant="outline">{t(`stage.${ASSISTANT_UI_LAB_STAGE_KEYS[stage]}`)}</Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSpeedIndex((current) => (current + 1) % SPEEDS.length)}
            >
              {t("controls.speed", { speed })}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={replay}>
              <RotateCcwIcon />
              {t("controls.replay")}
            </Button>
            <Button type="button" size="sm" onClick={() => setPlaying((current) => !current)}>
              {playing ? <PauseIcon /> : <PlayIcon />}
              {playing ? t("controls.pause") : t("controls.play")}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto pb-3">
          <div className="grid min-w-[1220px] grid-cols-3 gap-4">
            <ComparisonColumn
              title={t("columns.beautiful.title")}
              description={t("columns.beautiful.description")}
            >
              <BeautifulUiDemo key={`beautiful-${cycle}`} stage={stage} />
            </ComparisonColumn>
            <ComparisonColumn
              title={t("columns.assistant.title")}
              description={t("columns.assistant.description")}
            >
              <AssistantUiDemo key={`assistant-${cycle}`} stage={stage} />
            </ComparisonColumn>
            <ComparisonColumn
              title={t("columns.elements.title")}
              description={t("columns.elements.description")}
            >
              <AiElementsDemo key={`elements-${cycle}`} stage={stage} />
            </ComparisonColumn>
          </div>
        </div>
      </div>
    </main>
    </TooltipProvider>
  );
}
