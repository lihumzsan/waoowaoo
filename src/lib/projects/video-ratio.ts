export const PROJECT_VIDEO_RATIOS = ['9:16', '16:9', '21:9'] as const
export type ProjectVideoRatio = (typeof PROJECT_VIDEO_RATIOS)[number]
