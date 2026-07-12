import { describe, expect, it } from 'vitest'
import {
  locationSpatialProfileSchema,
} from '@/lib/location-spatial-profile/types'

const validProfile = {
  sceneSummary: '寺院庭院中央有石径，左侧有木门，右侧有长凳。',
  anchors: [{
    id: 'anchor_left_door',
    label: '左侧木门',
    screenArea: '画面左后方',
    depthLayer: '背景',
    spatialRelations: ['木门右侧是石径', '木门位于庭院左后方'],
  }],
  depthLayout: {
    foreground: '前景是石径入口',
    midground: '中景是庭院空地',
    background: '背景是木门和墙面',
  },
  lightingDirection: '光线从画面右侧照入',
}

describe('LocationSpatialProfile schema', () => {
  it('accepts Chinese natural-language spatial facts with anchors only', () => {
    const profile = locationSpatialProfileSchema.parse(validProfile)

    expect(profile.sceneSummary).toBe('寺院庭院中央有石径，左侧有木门，右侧有长凳。')
    expect(profile.anchors[0]?.label).toBe('左侧木门')
  })

  it('rejects placementZones because spatial profiles use anchors only', () => {
    expect(() => locationSpatialProfileSchema.parse({
      ...validProfile,
      placementZones: [{
        id: 'zone_left_door_inside',
        label: '左侧木门内侧靠墙的位置',
      }],
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
      anchors: [{
        ...validProfile.anchors[0],
        spatialRelations: ['锚点位于 x:3, y:4 的网格点'],
      }],
    })).toThrow('LOCATION_SPATIAL_PROFILE_COORDINATES_FORBIDDEN')
  })
})
