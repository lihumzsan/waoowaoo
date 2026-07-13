#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/asset-scope-ownership.md (ASO-01..08).

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

function requireText(violations, source, text, message) {
  if (!source.includes(text)) violations.push(message)
}

export function inspectAssetScopeOwnershipContract(input) {
  const violations = []
  for (const required of [
    'requireOwnedAssetProject',
    'requireOwnedAssetTarget',
    'requireOwnedAssetVariant',
    'requireAssetBodyVariantOwnership',
    "project: { userId: input.access.userId }",
    'assetKind: input.kind',
  ]) {
    requireText(violations, input.authority, required, `asset scope authority missing: ${required}`)
  }

  for (const required of [
    'await requireAssetBodyVariantOwnership(input, client)',
    'await requireOwnedAssetTarget(input, transaction)',
    'await requireOwnedAssetVariant(input, transaction)',
    'await requireOwnedAssetProject(input.access, transaction)',
  ]) {
    requireText(violations, input.actions, required, `asset action bypasses scoped authority: ${required}`)
  }
  const copyStart = input.actions.indexOf('export async function copyAssetFromGlobal')
  const copyEnd = input.actions.indexOf('async function copyCharacterFromGlobal', copyStart)
  const copyBody = copyStart >= 0 && copyEnd > copyStart ? input.actions.slice(copyStart, copyEnd) : ''
  const copyTargetChecks = copyBody.match(/requireOwnedAssetTarget/g)?.length ?? 0
  if (copyTargetChecks !== 2) {
    violations.push('copyAssetFromGlobal must authorize exactly one global source and one project target')
  }

  requireText(
    violations,
    input.apiOperations,
    'api_assets_copy_from_global: defineOperation',
    'unified copy operation missing',
  )
  const operationStart = input.apiOperations.indexOf('api_assets_copy_from_global: defineOperation')
  const operationEnd = input.apiOperations.indexOf('api_assets_update_variant: defineOperation', operationStart)
  const operationBody = operationStart >= 0 && operationEnd > operationStart
    ? input.apiOperations.slice(operationStart, operationEnd)
    : ''
  requireText(
    violations,
    operationBody,
    'executeInTransaction:',
    'copy operation must validate and replace inside one transaction',
  )

  const uploadValidation = input.upload.indexOf('await requireOwnedAsset')
  const uploadSideEffect = input.upload.indexOf('await uploadObject')
  if (uploadValidation < 0 || uploadSideEffect < 0 || uploadValidation > uploadSideEffect) {
    violations.push('project upload must authorize its target before object-storage side effects')
  }

  for (const destructiveEntry of [
    'deleteProjectLocationBackedAsset(input.assetId, transaction)',
    'deleteGlobalLocationBackedAsset(input.assetId, transaction)',
  ]) {
    requireText(violations, input.actions, destructiveEntry, `destructive asset entry missing: ${destructiveEntry}`)
  }
  if (input.locationBackedCallers.some((file) => !file.endsWith('src/lib/assets/services/asset-actions.ts'))) {
    violations.push('location-backed destructive helpers must only be called through scoped asset actions')
  }
  for (const [label, source] of [
    ['asset actions', input.actions],
    ['project selection', input.projectSelection],
    ['location-backed assets', input.locationBackedAssets],
    ['project deletion', input.projectCrud],
  ]) {
    for (const forbidden of ['deleteObject(', 'deleteObjects(', 'resolveStorageKeyFromMediaValue']) {
      if (source.includes(forbidden)) {
        violations.push(`${label} restores domain-owned physical media deletion: ${forbidden}`)
      }
    }
  }

  return violations
}

function findCallers(root, symbol) {
  const sourceRoot = path.join(root, 'src')
  const callers = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
        const relative = path.relative(root, fullPath).split(path.sep).join('/')
        const source = fs.readFileSync(fullPath, 'utf8')
        const matches = source.match(new RegExp(`\\b${symbol}\\s*\\(`, 'g'))?.length ?? 0
        const declarationAllowance = relative.endsWith('src/lib/assets/services/location-backed-assets.ts') ? 1 : 0
        if (matches > declarationAllowance) callers.push(relative)
      }
    }
  }
  visit(sourceRoot)
  return callers
}

function runCli() {
  const root = process.cwd()
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
  const locationBackedCallers = [
    ...findCallers(root, 'deleteProjectLocationBackedAsset'),
    ...findCallers(root, 'deleteGlobalLocationBackedAsset'),
  ]
  const violations = inspectAssetScopeOwnershipContract({
    authority: read('src/lib/assets/services/asset-scope-ownership.ts'),
    actions: read('src/lib/assets/services/asset-actions.ts'),
    projectSelection: read('src/lib/assets/services/project-location-backed-selection.ts'),
    locationBackedAssets: read('src/lib/assets/services/location-backed-assets.ts'),
    upload: read('src/lib/assets/services/project-upload-render.ts'),
    apiOperations: read('src/lib/operations/api-only/assets-api-ops.ts'),
    projectCrud: read('src/lib/operations/domains/project/project-crud-ops.ts'),
    locationBackedCallers,
  })
  if (violations.length > 0) {
    console.error('[asset-scope-ownership] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[asset-scope-ownership] OK scoped owner/kind/parent authority and atomic copy')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
