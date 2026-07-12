export function editShotModelRef(shotNumber: number): string {
  return `shot-${String(shotNumber).padStart(3, '0')}`
}

export function editSegmentModelRef(segmentIndex: number): string {
  return `segment-${String(segmentIndex + 1).padStart(3, '0')}`
}
