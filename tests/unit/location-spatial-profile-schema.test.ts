import { describe, expect, it } from 'vitest'
import {
  deriveAvailableSlotsFromSpatialProfile,
  locationSpatialProfileSchema,
} from '@/lib/location-spatial-profile/types'

const validProfile = {
  schemaVersion: 1,
  sceneSummary: '寺院庭院中央有石径，左侧有木门，右侧有长凳。',
  anchors: [{
    id: 'anchor_left_door',
    label: '左侧木门',
    screenArea: '画面左后方',
    depthLayer: '背景',
    spatialRelations: ['木门右侧是石径', '木门前方有可站空地'],
  }],
  placementZones: [{
    id: 'zone_left_door_inside',
    label: '左侧木门内侧靠墙的位置',
    absolutePosition: '画面左后方靠墙',
    nearAnchors: ['左侧木门'],
    depthLayer: '背景',
    visibility: '适合半身或全身出现',
    spatialRelations: ['位于石径左后方', '距离长凳较远'],
  }],
  depthLayout: {
    foreground: '前景是石径入口',
    midground: '中景是庭院空地',
    background: '背景是木门和墙面',
  },
  lightingDirection: '光线从画面右侧照入',
}

describe('LocationSpatialProfile schema', () => {
  it('accepts Chinese natural-language spatial facts and derives display slots', () => {
    const profile = locationSpatialProfileSchema.parse(validProfile)

    expect(profile.sceneSummary).toBe('寺院庭院中央有石径，左侧有木门，右侧有长凳。')
    expect(deriveAvailableSlotsFromSpatialProfile(profile)).toEqual(['左侧木门内侧靠墙的位置'])
  })

  it('rejects empty placementZones because downstream blocking needs explicit standing areas', () => {
    expect(() => locationSpatialProfileSchema.parse({
      ...validProfile,
      placementZones: [],
    })).toThrow()
  })

  it('rejects forbidden 2D coordinate and director-decision fields', () => {
    expect(() => locationSpatialProfileSchema.parse({
      ...validProfile,
      blockedZones: [],
    })).toThrow()

    expect(() => locationSpatialProfileSchema.parse({
      ...validProfile,
      cameraVantages: [],
    })).toThrow()

    expect(() => locationSpatialProfileSchema.parse({
      ...validProfile,
      profileSource: 'final_image',
    })).toThrow()

    expect(() => locationSpatialProfileSchema.parse({
      ...validProfile,
      placementZones: [{
        ...validProfile.placementZones[0],
        spatialRelations: ['站在 x:3, y:4 的网格点'],
      }],
    })).toThrow('LOCATION_SPATIAL_PROFILE_COORDINATES_FORBIDDEN')
  })
})
