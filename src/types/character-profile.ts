/**
 * 角色档案数据结构
 * 用于角色视觉档案生成
 */

export interface CharacterProfileData {
    /** 角色原型 (如: 霸道总裁, 心机婊) */
    archetype: string

    /** 性格标签 */
    personality_tags: string[]

    /** 时代背景 */
    era_period: string

    /** 社会阶层 */
    social_class: string

    /** 职业 (可选) */
    occupation?: string

    /** 建议色彩 */
    suggested_colors: string[]

    /** 主要辨识标志 */
    primary_identifier?: string

    /** 视觉关键词 */
    visual_keywords: string[]

    /** 性别 */
    gender: string

    /** 年龄段描述 */
    age_range: string
}

/**
 * 将角色档案序列化为JSON字符串
 */
export function stringifyProfileData(profileData: CharacterProfileData): string {
    return JSON.stringify(profileData)
}

/**
 * 验证角色档案数据完整性
 */
export function validateProfileData(data: unknown): data is CharacterProfileData {
    if (!data || typeof data !== 'object') return false
    const candidate = data as Partial<CharacterProfileData>
    return !!(
        typeof candidate.archetype === 'string' &&
        Array.isArray(candidate.personality_tags) &&
        typeof candidate.era_period === 'string' &&
        typeof candidate.social_class === 'string' &&
        Array.isArray(candidate.suggested_colors) &&
        Array.isArray(candidate.visual_keywords) &&
        typeof candidate.gender === 'string' &&
        typeof candidate.age_range === 'string'
    )
}
