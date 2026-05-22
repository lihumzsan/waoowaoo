import type {
  FixedSpaceClassification,
  GridDensity,
  StoryboardFloorPlanSceneGroup,
  StoryboardBlockClassification,
  StoryboardConsistencySourceSnapshot,
} from './types'

const NO_FIXED_SPACE_PATTERNS = [
  'dream',
  'memory',
  'montage',
  'chase',
  'cutaway',
  'object-only',
  'landscape-only',
  '梦',
  '梦境',
  '回忆',
  '蒙太奇',
  '追逐',
  '空镜',
  '纯物件',
  '纯风景',
  '快速跳切',
] as const

const MACRO_EXTERIOR_LOCATION_PATTERNS = [
  'black hole',
  'wormhole',
  'deep space',
  'outer space',
  'starfield',
  'nebula',
  'galaxy',
  'sky',
  'cloud layer',
  '黑洞',
  '虫洞',
  '深空',
  '宇宙',
  '星空',
  '星云',
  '银河',
  '天空',
  '云层',
  '吸积盘',
] as const

const FLOOR_PLAN_ANCHOR_PATTERNS = [
  'interior',
  'room',
  'cockpit',
  'cabin',
  'bridge',
  'corridor',
  'hall',
  'courtyard',
  'street',
  'road',
  'door',
  'wall',
  'table',
  'chair',
  '内景',
  '房间',
  '室',
  '舱',
  '驾驶舱',
  '舰桥',
  '走廊',
  '大厅',
  '庭院',
  '街',
  '道路',
  '门',
  '墙',
  '桌',
  '椅',
] as const

function includesPattern(value: string, patterns: readonly string[]): boolean {
  const normalized = value.toLocaleLowerCase()
  return patterns.some((pattern) => normalized.includes(pattern.toLocaleLowerCase()))
}

function uniq(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function assetsForShot(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number, kind: 'character' | 'location') {
  return snapshot.assets.filter((asset) => asset.kind === kind && asset.shotNumbers.includes(shotNumber))
}

function shotText(snapshot: StoryboardConsistencySourceSnapshot, shotNumber: number): string {
  const shot = snapshot.shots.find((item) => item.shotNumber === shotNumber)
  if (!shot) return ''
  return [
    shot.visualAction,
    shot.charactersAndScene,
    shot.camera,
    shot.videoPrompt,
    shot.sound,
  ].join('\n')
}

function blockText(snapshot: StoryboardConsistencySourceSnapshot, shotNumbers: readonly number[], blockPrompt: string): string {
  return [
    blockPrompt,
    ...shotNumbers.map((shotNumber) => shotText(snapshot, shotNumber)),
  ].join('\n')
}

function readBlockParticipants(snapshot: StoryboardConsistencySourceSnapshot, shotNumbers: readonly number[]): string[] {
  return uniq(snapshot.assets
    .filter((asset) => asset.kind === 'character' && asset.shotNumbers.some((shotNumber) => shotNumbers.includes(shotNumber)))
    .map((asset) => asset.name))
}

function readBlockLocations(snapshot: StoryboardConsistencySourceSnapshot, shotNumbers: readonly number[]): string[] {
  return uniq(snapshot.assets
    .filter((asset) => asset.kind === 'location' && asset.shotNumbers.some((shotNumber) => shotNumbers.includes(shotNumber)))
    .map((asset) => asset.name))
}

function hasRepeatedLocation(snapshot: StoryboardConsistencySourceSnapshot, shotNumbers: readonly number[]): boolean {
  const counts = new Map<string, number>()
  for (const shotNumber of shotNumbers) {
    for (const location of assetsForShot(snapshot, shotNumber, 'location')) {
      counts.set(location.name, (counts.get(location.name) ?? 0) + 1)
    }
  }
  return Array.from(counts.values()).some((count) => count >= 2)
}

export function classifyStoryboardConsistencyBlocks(snapshot: StoryboardConsistencySourceSnapshot): StoryboardBlockClassification[] {
  return snapshot.videoBlocks.map((block) => {
    const participantNames = readBlockParticipants(snapshot, block.shotNumbers)
    const locationNames = readBlockLocations(snapshot, block.shotNumbers)
    const excludedByMotionOrAbstraction = includesPattern(
      blockText(snapshot, block.shotNumbers, block.prompt),
      NO_FIXED_SPACE_PATTERNS,
    )
    const repeatedLocation = hasRepeatedLocation(snapshot, block.shotNumbers)
    const classification: FixedSpaceClassification = excludedByMotionOrAbstraction
      ? 'no_fixed_space'
      : repeatedLocation && participantNames.length >= 2
        ? 'fixed_space_strong'
        : repeatedLocation && participantNames.length >= 1
          ? 'fixed_space_weak'
          : locationNames.length > 0 && participantNames.length >= 2
          ? 'fixed_space_weak'
          : 'no_fixed_space'
    const reason = classification === 'fixed_space_strong'
      ? 'same videoBlock contains repeated location coverage and at least two core characters'
      : classification === 'fixed_space_weak'
        ? 'same videoBlock has repeated or shared fixed-location coverage that benefits from coordinate blocking'
        : excludedByMotionOrAbstraction
          ? 'motion, abstraction, cutaway, object-only, or landscape-only language was detected'
          : 'fixed-space continuity signal is insufficient'
    return {
      sourceVideoBlockId: block.sourceVideoBlockId,
      blockIndex: block.blockIndex,
      classification,
      reason,
      participantNames,
      locationNames,
      excludedByMotionOrAbstraction,
    }
  })
}

function classificationRank(classification: FixedSpaceClassification): number {
  if (classification === 'fixed_space_strong') return 2
  if (classification === 'fixed_space_weak') return 1
  return 0
}

export function isFloorPlanLocationEligible(location: {
  readonly name: string
  readonly description: string
}): boolean {
  const locationText = `${location.name}\n${location.description}`
  const hasMacroExteriorSignal = includesPattern(locationText, MACRO_EXTERIOR_LOCATION_PATTERNS)
  const hasFloorPlanAnchorSignal = includesPattern(locationText, FLOOR_PLAN_ANCHOR_PATTERNS)
  return !hasMacroExteriorSignal || hasFloorPlanAnchorSignal
}

export function buildFloorPlanSceneGroups(
  snapshot: StoryboardConsistencySourceSnapshot,
  classifications: readonly StoryboardBlockClassification[] = classifyStoryboardConsistencyBlocks(snapshot),
): StoryboardFloorPlanSceneGroup[] {
  const groupByLocationId = new Map<string, {
    locationRequirementId: string
    locationTargetId: string
    locationName: string
    locationDescription: string
    sourceVideoBlockIds: Set<string>
    sourceShotNumbers: Set<number>
    classifications: FixedSpaceClassification[]
    participants: Set<string>
    reasons: string[]
  }>()

  for (const classification of classifications) {
    if (classification.classification === 'no_fixed_space') continue
    const block = snapshot.videoBlocks.find((item) => item.sourceVideoBlockId === classification.sourceVideoBlockId)
    if (!block) continue
    const locations = snapshot.assets.filter((asset) => (
      asset.kind === 'location'
      && isFloorPlanLocationEligible(asset)
      && asset.shotNumbers.some((shotNumber) => block.shotNumbers.includes(shotNumber))
    ))
    for (const location of locations) {
      const existing = groupByLocationId.get(location.targetId) ?? {
        locationRequirementId: location.requirementId,
        locationTargetId: location.targetId,
        locationName: location.name,
        locationDescription: location.description,
        sourceVideoBlockIds: new Set<string>(),
        sourceShotNumbers: new Set<number>(),
        classifications: [],
        participants: new Set<string>(),
        reasons: [],
      }
      existing.sourceVideoBlockIds.add(block.sourceVideoBlockId)
      block.shotNumbers.forEach((shotNumber) => existing.sourceShotNumbers.add(shotNumber))
      existing.classifications.push(classification.classification)
      classification.participantNames.forEach((participant) => existing.participants.add(participant))
      existing.reasons.push(`${classification.sourceVideoBlockId}: ${classification.reason}`)
      groupByLocationId.set(location.targetId, existing)
    }
  }

  return Array.from(groupByLocationId.values()).map((group, groupIndex) => ({
    groupIndex,
    locationRequirementId: group.locationRequirementId,
    locationTargetId: group.locationTargetId,
    locationName: group.locationName,
    locationDescription: group.locationDescription,
    sourceVideoBlockIds: Array.from(group.sourceVideoBlockIds),
    sourceShotNumbers: Array.from(group.sourceShotNumbers).sort((left, right) => left - right),
    classification: group.classifications.reduce<FixedSpaceClassification>((best, current) => (
      classificationRank(current) > classificationRank(best) ? current : best
    ), 'no_fixed_space'),
    participants: Array.from(group.participants),
    reason: group.reasons.join('\n'),
  }))
}

export function resolveGridDensity(videoRatio: string): GridDensity {
  const [widthRaw, heightRaw] = videoRatio.split(':')
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`EDIT_SCRIPT_STORYBOARD_VIDEO_RATIO_INVALID:${videoRatio}`)
  }
  if (width >= height) {
    return {
      columns: Math.max(9, Math.round(9 * width / height)),
      rows: 9,
      ratio: videoRatio,
      shortSideUnits: 9,
    }
  }
  return {
    columns: 9,
    rows: Math.max(9, Math.round(9 * height / width)),
    ratio: videoRatio,
    shortSideUnits: 9,
  }
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b > 0) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

export function resolveAspectRatioFromDimensions(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`EDIT_SCRIPT_STORYBOARD_IMAGE_DIMENSIONS_INVALID:${width}x${height}`)
  }
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

export function resolveGridDensityFromDimensions(width: number, height: number): GridDensity {
  return resolveGridDensity(resolveAspectRatioFromDimensions(width, height))
}
