import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('image preview modal', () => {
  it('closes only from backdrop clicks or explicit controls', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/ui/ImagePreviewModal.tsx'),
      'utf8',
    )

    expect(source).toContain('if (event.target === event.currentTarget) onClose()')
    expect(source).toContain('onClick={(event) => event.stopPropagation()}')
    expect(source).toContain('type="button"')
    expect(source).not.toContain('onClick={onClose}\n      style={{ margin: 0, padding: 0 }}')
  })

  it('renders the enlarged image without a rounded mask or background edge', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/ui/ImagePreviewModal.tsx'),
      'utf8',
    )

    expect(source).toContain('containerClassName="max-w-full max-h-[90vh] !bg-transparent"')
    expect(source).toContain('className="block max-w-full max-h-[90vh] object-contain shadow-2xl"')
    expect(source).not.toContain('object-contain rounded-lg shadow-2xl')
  })

  it('is reused by canvas detail images instead of local preview surfaces', () => {
    const editScriptPreviewSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/canvas/details/EditScriptPreviewDetail.tsx'),
      'utf8',
    )
    const arrangementSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/canvas/GenerationSegmentArrangementModal.tsx'),
      'utf8',
    )

    expect(editScriptPreviewSource).toContain("import ImagePreviewModal from '@/components/ui/ImagePreviewModal'")
    expect(editScriptPreviewSource).toContain('setPreviewImageUrl(activeShot.imageUrl)')
    expect(arrangementSource).toContain("import ImagePreviewModal from '@/components/ui/ImagePreviewModal'")
    expect(arrangementSource).toContain('setPreviewImageUrl(shot.imageUrl)')
  })
})
