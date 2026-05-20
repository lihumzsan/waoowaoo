export interface ModelCapabilityGroupOption {
    value: string
    provider?: string
    providerName?: string
}

export function resolveModelCapabilityProviderLabel(
    option: Pick<ModelCapabilityGroupOption, 'provider' | 'providerName'>,
    fallbackLabel: string,
): string {
    return option.providerName || option.provider || fallbackLabel
}

export function groupModelCapabilityOptions<T extends ModelCapabilityGroupOption>(
    models: readonly T[],
    fallbackProviderLabel: string,
): Array<readonly [string, T[]]> {
    const grouped = new Map<string, T[]>()
    for (const model of models) {
        const key = resolveModelCapabilityProviderLabel(model, fallbackProviderLabel)
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(model)
    }
    return Array.from(grouped.entries())
}

export function resolveSelectedModelProviderLabel(
    models: readonly ModelCapabilityGroupOption[],
    value: string | undefined,
    fallbackProviderLabel: string,
): string | null {
    if (!value) return null
    const selected = models.find((model) => model.value === value)
    if (!selected) return null
    return resolveModelCapabilityProviderLabel(selected, fallbackProviderLabel)
}
