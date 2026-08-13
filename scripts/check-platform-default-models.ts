import {
  getPlatformDefaultModelCatalog,
  getPlatformDefaultModels,
} from '@/lib/platform-models/catalog'

const defaults = getPlatformDefaultModels()
const catalog = getPlatformDefaultModelCatalog()

if (catalog.length === 0) {
  throw new Error('PLATFORM_DEFAULT_MODEL_CATALOG_EMPTY')
}

process.stdout.write(`PLATFORM_DEFAULT_MODELS_OK fields=${Object.keys(defaults).length} unique=${catalog.length}\n`)
