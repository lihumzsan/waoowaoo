'use client'

import { useTranslations } from 'next-intl'
import {
    buildOperationPlanConfirmationText,
    fetchOperationPlanView,
    readPlanConfirmedMaxCost,
} from './operation-plan-client'

export function useConfirmMediaOperationPlan(projectId: string | null, episodeId?: string | null) {
    const t = useTranslations('assistantAgent')

    return async (operationId: string, input: Record<string, unknown>) => {
        if (!projectId) throw new Error('PROJECT_ID_REQUIRED')
        const plan = await fetchOperationPlanView({
            projectId,
            operationId,
            input,
            context: episodeId ? { episodeId } : undefined,
        })
        const message = buildOperationPlanConfirmationText({
            plan,
            withCredits: (values) => t('cards.billingQuoteWithCredits', values),
            withoutCredits: (values) => t('cards.billingQuoteWithoutCredits', values),
        })
        if (message && !window.confirm(message)) {
            throw new Error(t('cards.billingConfirmationCancelled'))
        }
        return readPlanConfirmedMaxCost(plan)
    }
}
