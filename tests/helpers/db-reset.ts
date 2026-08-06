import { prisma } from './prisma'

async function resetWorkspaceResourceState() {
  await prisma.workspaceResourceLineage.deleteMany()
  await prisma.workspaceResource.deleteMany()
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

async function resetPaidBetaAndAnnouncementState() {
  await prisma.paidBetaPaymentAttempt.deleteMany()
  await prisma.paidBetaSeat.deleteMany()
  await prisma.paidBetaCampaign.deleteMany()
  await prisma.announcementReceipt.deleteMany()
}

export async function resetBillingState() {
  await resetPaidBetaAndAnnouncementState()
  await prisma.balanceTransaction.deleteMany()
  await prisma.balanceFreeze.deleteMany()
  await prisma.usageCost.deleteMany()
  await prisma.subscriptionGrant.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.llmBillingMeter.deleteMany()
  await resetAgentTurnState()
  await resetWorkspaceResourceState()
  await resetTaskExecutionState()
  await resetOperationExecutionState()
  await prisma.userBalance.deleteMany()
  await prisma.project.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.userPreference.deleteMany()
  await prisma.user.deleteMany()
}

export async function resetTaskState() {
  await resetAgentTurnState()
  await resetWorkspaceResourceState()
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

export async function resetSystemState() {
  await resetPaidBetaAndAnnouncementState()
  await resetTaskState()
  await resetAssetHubState()
  await prisma.usageCost.deleteMany()
  await prisma.project.deleteMany()
  await prisma.userPreference.deleteMany()
  await prisma.account.deleteMany()
  await prisma.session.deleteMany()
  await prisma.userBalance.deleteMany()
  await prisma.balanceFreeze.deleteMany()
  await prisma.balanceTransaction.deleteMany()
  await prisma.llmBillingMeter.deleteMany()
  await prisma.user.deleteMany()
}
