import { prisma } from './prisma'

async function resetCreativeResourceState() {
  await prisma.creativeResourceBinding.deleteMany()
  await prisma.creativeResourceLineage.deleteMany()
  await prisma.creativeResource.deleteMany()
}

async function resetAgentTurnState() {
  await prisma.agentTurnInteraction.deleteMany()
  await prisma.agentToolEffect.deleteMany()
  await prisma.projectAgentTurn.deleteMany()
  await prisma.projectAssistantThread.deleteMany()
  await prisma.projectAssistantThreadArchive.deleteMany()
}

async function resetOperationExecutionState() {
  await prisma.operationExecution.deleteMany()
  await prisma.approvalGrant.deleteMany()
  await prisma.operationPlanSnapshot.deleteMany()
}

async function resetTaskExecutionState() {
  await prisma.followUpBatchMember.deleteMany()
  await prisma.followUpBatch.deleteMany()
  await prisma.taskExecutionCheckpoint.deleteMany()
  await prisma.taskEvent.deleteMany()
  await prisma.task.deleteMany()
}

export async function resetBillingState() {
  await prisma.balanceTransaction.deleteMany()
  await prisma.balanceFreeze.deleteMany()
  await prisma.usageCost.deleteMany()
  await resetAgentTurnState()
  await resetCreativeResourceState()
  await resetTaskExecutionState()
  await resetOperationExecutionState()
  await prisma.inviteRedemption.deleteMany()
  await prisma.inviteCode.deleteMany()
  await prisma.userBalance.deleteMany()
  await prisma.project.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.userPreference.deleteMany()
  await prisma.user.deleteMany()
}

export async function resetTaskState() {
  await resetAgentTurnState()
  await resetCreativeResourceState()
  await resetTaskExecutionState()
  await resetOperationExecutionState()
}

export async function resetAssetHubState() {
  await prisma.globalCharacterAppearance.deleteMany()
  await prisma.globalCharacter.deleteMany()
  await prisma.globalLocationImage.deleteMany()
  await prisma.globalLocation.deleteMany()
  await prisma.globalAssetFolder.deleteMany()
}

export async function resetProjectWorkflowState() {
  await prisma.characterAppearance.deleteMany()
  await prisma.locationImage.deleteMany()
  await prisma.projectCharacter.deleteMany()
  await prisma.projectLocation.deleteMany()
  await prisma.projectEpisode.deleteMany()
}

export async function resetSystemState() {
  await resetTaskState()
  await resetAssetHubState()
  await resetProjectWorkflowState()
  await prisma.usageCost.deleteMany()
  await prisma.project.deleteMany()
  await prisma.userPreference.deleteMany()
  await prisma.account.deleteMany()
  await prisma.session.deleteMany()
  await prisma.userBalance.deleteMany()
  await prisma.balanceFreeze.deleteMany()
  await prisma.balanceTransaction.deleteMany()
  await prisma.inviteRedemption.deleteMany()
  await prisma.inviteCode.deleteMany()
  await prisma.user.deleteMany()
}
