import { logError as _ulogError } from '@/lib/logging/core'
import { z } from 'zod'
/**
 * AI 设计共享工具函数
 * 统一处理 Asset Hub 和 Novel Promotion 的 AI 设计逻辑
 */

import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { withTextBilling } from '@/lib/billing'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS } from '@/lib/ai-prompts'
import type { Locale } from '@/i18n/routing'

export type AssetType = 'character' | 'location'

export interface AIDesignOptions {
    userId: string
    locale: Locale
    analysisModel: string
    userInstruction: string
    assetType: AssetType
    /** 用于计费的上下文：'asset-hub' 或实际的 projectId */
    projectId?: string
    /** 任务 worker 内执行时使用，避免和任务计费重复 */
    skipBilling?: boolean
}

export interface AIDesignResult {
    success: boolean
    prompt?: string
    error?: string
}

/**
 * AI 设计通用函数
 * 根据用户指令生成角色或场景的 prompt 描述
 */
export async function aiDesign(options: AIDesignOptions): Promise<AIDesignResult> {
    const {
        userId,
        locale,
        analysisModel,
        userInstruction,
        assetType,
        projectId = 'asset-hub',
        skipBilling = false,
    } = options

    if (!userInstruction?.trim()) {
        return {
            success: false,
            error: assetType === 'character' ? '请输入人物设计需求' : '请输入场景设计需求'
        }
    }

    if (!analysisModel) {
        return {
            success: false,
            error: '请先在用户配置中设置分析模型'
        }
    }

    let finalPrompt: string
    try {
        finalPrompt = buildPrompt({
            promptId: assetType === 'character'
                ? PROMPT_IDS.CHARACTER_CREATE
                : PROMPT_IDS.LOCATION_CREATE,
            locale,
            variables: {
                user_input: userInstruction,
            },
        })
    } catch {
        _ulogError('[AI Design] 提示词加载失败')
        return { success: false, error: '系统配置错误' }
    }

    // 调用 LLM
    const action = assetType === 'character' ? 'ai_design_character' : 'ai_design_location'
    const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
    const runCompletion = async () =>
        await executeAiStructuredTextStep({
            userId,
            model: analysisModel,
            messages: [{ role: 'user', content: finalPrompt }],
            projectId,
            action,
            locale,
            meta: {
                stepId: action,
                stepTitle: assetType === 'character' ? '角色设计' : '场景设计',
                stepIndex: 1,
                stepTotal: 1,
            },
            schema: z.unknown(),
            parse: { kind: 'object' },
            validate: (raw) => {
                const record = raw && typeof raw === 'object' && !Array.isArray(raw)
                    ? raw as Record<string, unknown>
                    : {}
                const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
                if (!prompt) {
                    throw new Error('AI返回缺少prompt字段')
                }
                return { prompt }
            },
        })
    const completion = skipBilling
        ? await runCompletion()
        : await withTextBilling(
            userId,
            analysisModel,
            maxInputTokens,
            { projectId, action, metadata: { assetType } },
            runCompletion,
        )

    if (!completion.text) {
        return { success: false, error: 'AI返回内容为空' }
    }

    return {
        success: true,
        prompt: completion.data.prompt,
    }
}
