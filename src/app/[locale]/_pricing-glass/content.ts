import { buildSubscriptionPlanViews, type SubscriptionPlanView } from '@/lib/billing/subscription-plan-view'
import type { SubscriptionInterval, SubscriptionPlanId } from '@/lib/billing/subscription-plans'
import type {
  OfficialContactPageContent,
  OfficialPricingPageContent,
} from '@/lib/public-site/official-content'

export interface GlassPlanInterval {
  readonly interval: SubscriptionInterval
  /** Charged once per cycle. */
  readonly periodPriceCny: number
  /** Cycle price spread over its months — the headline number on the card. */
  readonly monthlyEquivalentCny: number
  /** Absolute CNY saved per year versus paying monthly. Zero for monthly. */
  readonly savingsVersusMonthlyCny: number
}

export interface GlassPlan {
  readonly id: SubscriptionPlanId
  readonly label: string
  readonly name: string
  readonly unit: string
  readonly credits: string
  readonly creditsAmount: number
  readonly tagline: string
  readonly featured: boolean
  /** First-period promotional price, monthly only. Null when there is none. */
  readonly firstMonthPromoCny: number | null
  /** What a month's credits cover, if spent entirely on one kind of work. */
  readonly monthlyVideos: number
  readonly monthlyImages: number
  readonly details: readonly string[]
  /** Both billing cycles, so the page can switch without another request. */
  readonly intervals: Readonly<Record<SubscriptionInterval, GlassPlanInterval>>
}

export interface GlassCapacityReference {
  readonly videoCredits: number
  readonly videoDurationSeconds: number
  readonly videoResolution: string
  readonly imageCredits: number
}

export interface GlassPricingContent {
  readonly brand: string
  readonly plans: readonly GlassPlan[]
  /** Unit prices behind the capacity claims, so the page can show its maths. */
  readonly capacityReference: GlassCapacityReference
  readonly creditUnitCny: number
  readonly creditPolicy: {
    readonly title: string
    readonly body: string
  }
  readonly paymentNote: string
  readonly faqs: ReadonlyArray<{ readonly q: string; readonly a: string }>
  readonly merchant: {
    readonly title: string
    readonly description: string
    readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>
    readonly portalOnly: {
      readonly title: string
      readonly description: string
      readonly items: readonly string[]
    }
  }
}

export interface BuildGlassPricingInput {
  readonly pricing: OfficialPricingPageContent
  readonly contact: OfficialContactPageContent
}

function formatCreditsLabel(creditsAmount: number): string {
  return `${creditsAmount.toLocaleString()} credits`
}

function toIntervalMap(
  plan: SubscriptionPlanView,
): Readonly<Record<SubscriptionInterval, GlassPlanInterval>> {
  const byInterval = new Map(plan.intervals.map((entry) => [entry.interval, entry]))
  const month = byInterval.get('month')
  const year = byInterval.get('year')
  if (!month || !year) throw new Error(`PRICING_PLAN_INTERVAL_MISSING: ${plan.id}`)
  const project = (entry: typeof month): GlassPlanInterval => ({
    interval: entry.interval,
    periodPriceCny: entry.periodPriceCny,
    monthlyEquivalentCny: entry.monthlyEquivalentCny,
    savingsVersusMonthlyCny: entry.savingsVersusMonthlyCny,
  })
  return { month: project(month), year: project(year) }
}

export function buildGlassPricingContent(input: BuildGlassPricingInput): GlassPricingContent {
  const catalog = buildSubscriptionPlanViews()
  const catalogPlans = new Map(catalog.plans.map((plan) => [plan.id, plan]))
  return {
    capacityReference: catalog.capacityReference,
    creditUnitCny: catalog.creditUnitCny,
    brand: input.pricing.brand,
    // Prices come from the billing catalog, never from the content file: the
    // page must not be able to advertise a cycle or amount that checkout would
    // not honour.
    plans: input.pricing.plans.map((plan) => {
      const catalogPlan = catalogPlans.get(plan.id)
      if (!catalogPlan) throw new Error(`PRICING_PLAN_NOT_IN_CATALOG: ${plan.id}`)
      return {
        id: plan.id,
        label: plan.label,
        name: plan.name,
        unit: plan.unit,
        credits: formatCreditsLabel(catalogPlan.monthlyCredits),
        creditsAmount: catalogPlan.monthlyCredits,
        tagline: plan.tagline,
        featured: catalogPlan.featured,
        firstMonthPromoCny: catalogPlan.firstMonthPromoCny,
        monthlyVideos: catalogPlan.monthlyCapacity.videos,
        monthlyImages: catalogPlan.monthlyCapacity.images,
        details: plan.details,
        intervals: toIntervalMap(catalogPlan),
      }
    }),
    creditPolicy: input.pricing.creditPolicy,
    paymentNote: input.pricing.paymentNote,
    faqs: input.pricing.faqs.map((faq) => ({
      q: faq.question,
      a: faq.answer,
    })),
    merchant: {
      title: input.contact.publicInfo.title,
      description: input.contact.description,
      fields: input.contact.publicInfo.fields,
      portalOnly: input.contact.portalOnly,
    },
  }
}
