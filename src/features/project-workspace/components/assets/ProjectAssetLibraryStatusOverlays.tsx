'use client'

import { AppIcon } from '@/components/ui/icons'

type ToastType = 'success' | 'warning' | 'error'

interface ToastState {
  message: string
  type: ToastType
}

interface ProjectAssetLibraryStatusOverlaysProps {
  toast: ToastState | null
  onCloseToast: () => void
}

export default function ProjectAssetLibraryStatusOverlays({
  toast,
  onCloseToast,
}: ProjectAssetLibraryStatusOverlaysProps) {
  return (
    <>
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-right">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg ${
              toast.type === 'success'
                ? 'bg-[var(--glass-tone-success-fg)] text-white'
                : toast.type === 'warning'
                  ? 'bg-[var(--glass-tone-warning-fg)] text-white'
                  : 'bg-[var(--glass-tone-danger-fg)] text-white'
            }`}
          >
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={onCloseToast} className="ml-2 hover:opacity-80">
              <AppIcon name="close" className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

    </>
  )
}
