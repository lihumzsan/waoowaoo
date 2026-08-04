import type {
  OfficialContactPageContent,
  OfficialPricingPageContent,
} from '@/lib/public-site/official-content'

export interface GlassPlan {
  readonly id: string
  readonly label: string
  readonly name: string
  readonly price: string
  readonly unit: string
  readonly credits: string
  readonly creditsAmount: number
  readonly tagline: string
  readonly details: readonly string[]
}

export interface GlassPricingContent {
  readonly brand: string
  readonly title: string
  readonly subtitle: string
  readonly plans: readonly GlassPlan[]
  readonly compareRows: ReadonlyArray<{ readonly label: string; readonly values: readonly string[] }>
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

export function buildGlassPricingContent(input: BuildGlassPricingInput): GlassPricingContent {
  return {
    brand: input.pricing.brand,
    title: input.pricing.title,
    subtitle: input.pricing.description,
    plans: input.pricing.plans.map((plan) => ({
      id: plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label: plan.label,
      name: plan.name,
      price: plan.price,
      unit: plan.unit,
      credits: formatCreditsLabel(plan.creditsAmount),
      creditsAmount: plan.creditsAmount,
      tagline: plan.tagline,
      details: plan.details,
    })),
    compareRows: input.pricing.compareRows,
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
