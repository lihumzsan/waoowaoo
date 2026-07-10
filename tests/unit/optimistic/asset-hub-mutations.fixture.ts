import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueryClient } from '@tanstack/react-query'

import type { GlobalCharacter, GlobalLocation } from '@/lib/query/hooks/useGlobalAssets'

import type { AssetSummary } from '@/lib/assets/contracts'

import { queryKeys } from '@/lib/query/keys'

import { MockQueryClient } from '../../helpers/mock-query-client'

let queryClient = new MockQueryClient()

function resetAssetHubQueryClient(): MockQueryClient {
  queryClient = new MockQueryClient()
  return queryClient
}

const useQueryClientMock = vi.fn(() => queryClient)

const useMutationMock = vi.fn((options: unknown) => options)

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useRef: <T,>(value: T) => ({ current: value }),
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => useQueryClientMock(),
  useMutation: (options: unknown) => useMutationMock(options),
}))

vi.mock('@/lib/query/mutations/mutation-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/mutations/mutation-shared')>(
    '@/lib/query/mutations/mutation-shared',
  )
  return {
    ...actual,
    requestJsonWithError: vi.fn(),
    requestVoidWithError: vi.fn(),
  }
})

import {
  useGenerateCharacterImage,
  useSelectCharacterImage,
} from '@/lib/query/mutations/asset-hub-character-mutations'

import { useCreateAssetHubCharacter } from '@/lib/query/mutations/asset-hub-creation-mutations'

import { useDeleteLocation as useDeleteAssetHubLocation } from '@/lib/query/mutations/asset-hub-location-mutations'

import { invalidateGlobalCharacters } from '@/lib/query/mutations/asset-hub-mutations-shared'

interface SelectCharacterMutation {
  onMutate: (variables: {
    characterId: string
    appearanceIndex: number
    imageIndex: number | null
  }) => Promise<unknown>
  onError: (error: unknown, variables: unknown, context: unknown) => void
}

interface GenerateCharacterMutation {
  onMutate: (variables: {
    characterId: string
    appearanceId: string
    appearanceIndex: number
  }) => Promise<unknown>
  onSuccess: (
    data: { taskId?: string | null },
    variables: { appearanceId: string },
  ) => void
  onError: (error: unknown, variables: { appearanceId: string }, context: unknown) => void
}

interface CreateCharacterMutation {
  onSuccess: (
    data: { character?: GlobalCharacter },
    variables: {
      name: string
      description: string
      folderId?: string | null
      generateFromReference?: boolean
    },
  ) => void
}

interface DeleteLocationMutation {
  onMutate: (locationId: string) => Promise<unknown>
  onError: (error: unknown, locationId: string, context: unknown) => void
}

function buildGlobalCharacter(selectedIndex: number | null): GlobalCharacter {
  return {
    id: 'character-1',
    name: 'Hero',
    folderId: 'folder-1',
    appearances: [{
      id: 'appearance-1',
      appearanceIndex: 0,
      changeReason: 'default',
      description: null,
      descriptionSource: null,
      imageUrl: selectedIndex === null ? null : `img-${selectedIndex}`,
      imageUrls: ['img-0', 'img-1', 'img-2'],
      selectedIndex,
      previousImageUrl: null,
      previousImageUrls: [],
      imageTaskRunning: false,
    }],
  }
}

function buildGlobalLocation(id: string): GlobalLocation {
  return {
    id,
    name: `Location ${id}`,
    summary: null,
    folderId: 'folder-1',
    images: [{
      id: `${id}-img-0`,
      imageIndex: 0,
      description: null,
      imageUrl: null,
      previousImageUrl: null,
      isSelected: true,
      imageTaskRunning: false,
    }],
  }
}

function buildUnifiedCharacter(selectedIndex: number | null): AssetSummary {
  return {
    id: 'character-1',
    scope: 'global',
    kind: 'character',
    family: 'visual',
    name: 'Hero',
    folderId: 'folder-1',
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canCopyFromGlobal: true,
    },
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
    variants: [{
      id: 'appearance-1',
      index: 0,
      label: 'default',
      description: null,
      selectionState: { selectedRenderIndex: selectedIndex },
      taskRefs: [],
      taskState: { isRunning: false, lastError: null },
      renders: [0, 1, 2].map((index) => ({
        id: `appearance-1:${index}`,
        index,
        imageUrl: `img-${index}`,
        media: null,
        isSelected: selectedIndex === index,
        previousImageUrl: null,
        previousMedia: null,
        taskRefs: [],
        taskState: { isRunning: false, lastError: null },
      })),
    }],
    introduction: null,
    profileData: null,
    profileConfirmed: null,
  }
}

function buildUnifiedLocation(id: string): AssetSummary {
  return {
    id,
    scope: 'global',
    kind: 'location',
    family: 'visual',
    name: `Location ${id}`,
    folderId: 'folder-1',
    capabilities: {
      canGenerate: true,
      canSelectRender: true,
      canRevertRender: true,
      canModifyRender: true,
      canUploadRender: true,
      canCopyFromGlobal: true,
    },
    taskRefs: [],
    taskState: { isRunning: false, lastError: null },
    summary: null,
    selectedVariantId: `${id}-img-0`,
    variants: [{
      id: `${id}-img-0`,
      index: 0,
      label: 'Image 1',
      description: null,
      selectionState: { selectedRenderIndex: 0 },
      taskRefs: [],
      taskState: { isRunning: false, lastError: null },
      renders: [{
        id: `${id}-img-0`,
        index: 0,
        imageUrl: null,
        media: null,
        isSelected: true,
        previousImageUrl: null,
        previousMedia: null,
        taskRefs: [],
        taskState: { isRunning: false, lastError: null },
      }],
    }],
  }
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export type { QueryClient } from '@tanstack/react-query'
export type { GlobalCharacter, GlobalLocation } from '@/lib/query/hooks/useGlobalAssets'
export type { AssetSummary } from '@/lib/assets/contracts'
export { queryKeys } from '@/lib/query/keys'
export { MockQueryClient } from '../../helpers/mock-query-client'
export { useGenerateCharacterImage, useSelectCharacterImage } from '@/lib/query/mutations/asset-hub-character-mutations'
export { useCreateAssetHubCharacter } from '@/lib/query/mutations/asset-hub-creation-mutations'
export { useDeleteLocation as useDeleteAssetHubLocation } from '@/lib/query/mutations/asset-hub-location-mutations'
export { invalidateGlobalCharacters } from '@/lib/query/mutations/asset-hub-mutations-shared'
export { buildGlobalCharacter, buildGlobalLocation, buildUnifiedCharacter, buildUnifiedLocation, queryClient, resetAssetHubQueryClient, useMutationMock, useQueryClientMock }
export type { CreateCharacterMutation, DeleteLocationMutation, GenerateCharacterMutation, SelectCharacterMutation }
