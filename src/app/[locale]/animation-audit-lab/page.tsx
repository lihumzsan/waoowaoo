import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AnimationAuditLabClient from "./animation-audit-lab-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "animationAuditLab.meta",
  });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function AnimationAuditLabPage() {
  return <AnimationAuditLabClient />;
}
