import type { AppIconName } from '@/components/ui/icons'
import type { Locale } from '@/i18n/routing'

export const BILLING_UI_LAB_VARIANT_IDS = [
  'inline-action-metrics',
  'quote-summary-bar',
  'receipt-list',
  'canvas-node-badge',
  'budget-lock',
] as const

export type BillingUiLabVariantId = (typeof BILLING_UI_LAB_VARIANT_IDS)[number]

export interface BillingUiLabVariantCopy {
  readonly id: BillingUiLabVariantId
  readonly index: string
  readonly title: string
  readonly subtitle: string
  readonly rationale: string
  readonly icon: AppIconName
  readonly accent: 'ink' | 'teal' | 'amber' | 'blue' | 'rose'
}

export interface BillingUiLabQuoteCopy {
  readonly operationTitle: string
  readonly operationSubtitle: string
  readonly mediaTasks: string
  readonly targetPanels: string
  readonly credits: string
  readonly creditsShort: string
  readonly maxFreeze: string
  readonly model: string
  readonly continue: string
  readonly cancel: string
  readonly generateImage: string
  readonly expand: string
  readonly priceLine: string
  readonly imageTaskLine: string
  readonly fixedQuote: string
  readonly taskLabel: string
  readonly creditLabel: string
  readonly panelLabel: string
  readonly quoteReady: string
  readonly beforeSubmit: string
  readonly submitBoundary: string
  readonly currentProblem: string
  readonly directApi: string
  readonly assistantApproval: string
}

export interface BillingUiLabCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly recommendationTitle: string
  readonly recommendationBody: string
  readonly routeHint: string
  readonly quote: BillingUiLabQuoteCopy
  readonly variants: readonly BillingUiLabVariantCopy[]
}

const zhCopy: BillingUiLabCopy = {
  eyebrow: 'Billing UI Lab',
  title: '计费确认 UI 方案',
  intro: '5 种候选方案用于比较 assistant 确认卡、无限画布按钮和批量图片生成的价格露出方式。',
  recommendationTitle: '推荐方向',
  recommendationBody: '优先用“按钮内指标”处理 assistant 确认卡，用“画布节点露出”处理无限画布。两者都只消费 OperationPlan.quote，不在 UI 里重新计算价格。',
  routeHint: '/zh/billing-ui-lab',
  quote: {
    operationTitle: '生成分镜图片',
    operationSubtitle: '需要确认',
    mediaTasks: '3',
    targetPanels: '9',
    credits: '3.4128',
    creditsShort: '3.41',
    maxFreeze: '最多冻结 3.4128 credits',
    model: 'Storyboard image model',
    continue: '继续执行',
    cancel: '取消操作',
    generateImage: '生成图片',
    expand: '展开',
    priceLine: '3 个媒体生成任务 · 预计消耗 3.4128 credits',
    imageTaskLine: '1 个媒体生成任务 · 预计消耗 1.1376 credits',
    fixedQuote: '固定报价',
    taskLabel: '任务',
    creditLabel: 'credits',
    panelLabel: '分镜格',
    quoteReady: '预估已生成',
    beforeSubmit: '提交前确认',
    submitBoundary: '提交后进入任务队列并冻结额度',
    currentProblem: '当前截图里的价格在画布按钮区不可见，确认卡里的长句也像输入框。',
    directApi: 'GUI 生成资产走 API plan + confirmedMaxCost，不走 assistant approval 卡。',
    assistantApproval: 'assistant ask 模式下的 tool approval 才显示“继续执行”确认卡。',
  },
  variants: [
    {
      id: 'inline-action-metrics',
      index: '01',
      title: '按钮内指标',
      subtitle: '把 icon + 数字直接放到继续执行和生成图片按钮里。',
      rationale: '最适合你提到的确认卡：价格跟动作绑定，用户不会把价格当成单独表单字段。',
      icon: 'coins',
      accent: 'ink',
    },
    {
      id: 'quote-summary-bar',
      index: '02',
      title: '顶部摘要条',
      subtitle: '标题右侧放任务数和 credits，正文只保留确认语义。',
      rationale: '适合右侧 assistant 面板，信息密度高但不抢主按钮。',
      icon: 'receipt',
      accent: 'teal',
    },
    {
      id: 'receipt-list',
      index: '03',
      title: '收据式清单',
      subtitle: '把批量任务拆成可扫读的价格清单。',
      rationale: '适合价格可能由多组任务组成时使用，能解释 3 个任务覆盖 9 个分镜格。',
      icon: 'clipboardCheck',
      accent: 'amber',
    },
    {
      id: 'canvas-node-badge',
      index: '04',
      title: '画布节点露出',
      subtitle: '在无限画布节点的生成按钮旁显示短价格胶囊。',
      rationale: '直接解决画布里看不到生成价格的问题，短文案不会挤压节点布局。',
      icon: 'grid',
      accent: 'blue',
    },
    {
      id: 'budget-lock',
      index: '05',
      title: '预算锁',
      subtitle: '把“最多冻结”放成确认前的明确边界。',
      rationale: '适合高成本操作：强调上限、任务数和提交边界，降低误点风险。',
      icon: 'lock',
      accent: 'rose',
    },
  ],
}

const enCopy: BillingUiLabCopy = {
  eyebrow: 'Billing UI Lab',
  title: 'Billing Confirmation UI Options',
  intro: 'Five candidates for comparing price visibility in assistant confirmations, infinite-canvas actions, and batch image generation.',
  recommendationTitle: 'Recommendation',
  recommendationBody: 'Use inline action metrics for the assistant confirmation card, and canvas node badges for infinite-canvas actions. Both should read from OperationPlan.quote and never recalculate price in UI.',
  routeHint: '/en/billing-ui-lab',
  quote: {
    operationTitle: 'Generate storyboard images',
    operationSubtitle: 'Confirmation required',
    mediaTasks: '3',
    targetPanels: '9',
    credits: '3.4128',
    creditsShort: '3.41',
    maxFreeze: 'Freeze up to 3.4128 credits',
    model: 'Storyboard image model',
    continue: 'Continue',
    cancel: 'Cancel',
    generateImage: 'Generate image',
    expand: 'Expand',
    priceLine: '3 media generation tasks · estimated 3.4128 credits',
    imageTaskLine: '1 media generation task · estimated 1.1376 credits',
    fixedQuote: 'Fixed quote',
    taskLabel: 'Tasks',
    creditLabel: 'credits',
    panelLabel: 'Panels',
    quoteReady: 'Quote ready',
    beforeSubmit: 'Confirm before submit',
    submitBoundary: 'After submit, tasks enter the queue and credits are frozen',
    currentProblem: 'The current canvas action hides price, while the confirmation card renders the long quote like an input.',
    directApi: 'GUI asset generation uses API plan + confirmedMaxCost, not an assistant approval card.',
    assistantApproval: 'Only assistant tool approval in ask mode renders the Continue confirmation card.',
  },
  variants: [
    {
      id: 'inline-action-metrics',
      index: '01',
      title: 'Inline Action Metrics',
      subtitle: 'Put icon + number directly inside Continue and Generate image buttons.',
      rationale: 'Best fit for the confirmation card: cost is attached to the action instead of looking like a separate input.',
      icon: 'coins',
      accent: 'ink',
    },
    {
      id: 'quote-summary-bar',
      index: '02',
      title: 'Header Summary Bar',
      subtitle: 'Show task count and credits beside the title, leaving the body focused on confirmation.',
      rationale: 'Works well in the assistant panel: dense, readable, and secondary to the primary action.',
      icon: 'receipt',
      accent: 'teal',
    },
    {
      id: 'receipt-list',
      index: '03',
      title: 'Receipt List',
      subtitle: 'Render batch tasks as a scannable price receipt.',
      rationale: 'Useful when one price is composed of multiple task groups, such as 3 tasks covering 9 panels.',
      icon: 'clipboardCheck',
      accent: 'amber',
    },
    {
      id: 'canvas-node-badge',
      index: '04',
      title: 'Canvas Node Badge',
      subtitle: 'Show a compact price chip beside the infinite-canvas generate action.',
      rationale: 'Directly fixes hidden canvas pricing without forcing long text into node controls.',
      icon: 'grid',
      accent: 'blue',
    },
    {
      id: 'budget-lock',
      index: '05',
      title: 'Budget Lock',
      subtitle: 'Make the maximum freeze explicit before execution.',
      rationale: 'Best for higher-cost actions: it clarifies the upper bound, task count, and submit boundary.',
      icon: 'lock',
      accent: 'rose',
    },
  ],
}

const COPY_BY_LOCALE: Record<Locale, BillingUiLabCopy> = {
  zh: zhCopy,
  en: enCopy,
}

export function getBillingUiLabCopy(locale: Locale | string | undefined): BillingUiLabCopy {
  return locale === 'en' ? COPY_BY_LOCALE.en : COPY_BY_LOCALE.zh
}

export function getBillingUiLabVariant(
  id: BillingUiLabVariantId,
  locale: Locale | string | undefined,
): BillingUiLabVariantCopy {
  const copy = getBillingUiLabCopy(locale)
  const variant = copy.variants.find((item) => item.id === id)
  if (!variant) throw new Error(`BILLING_UI_LAB_VARIANT_MISSING:${id}`)
  return variant
}
