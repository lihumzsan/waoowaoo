import type { DeploymentConfig } from './config'

export interface DeploymentFeatures {
  showOfficialPublicPages: boolean
  showPricingPage: boolean
  showLegalPages: boolean
  showRecharge: boolean
  showInviteCode: boolean
  showBilling: boolean
  showApiConfig: boolean
  requireInviteCodeOnSignup: boolean
  usePlatformProviderConfig: boolean
}

const SELF_HOSTED_DEPLOYMENT_FEATURES: DeploymentFeatures = {
  showOfficialPublicPages: false,
  showPricingPage: false,
  showLegalPages: false,
  showRecharge: false,
  showInviteCode: false,
  showBilling: false,
  showApiConfig: true,
  requireInviteCodeOnSignup: false,
  usePlatformProviderConfig: false,
}

const CLOUD_DEPLOYMENT_FEATURES: DeploymentFeatures = {
  showOfficialPublicPages: true,
  showPricingPage: true,
  showLegalPages: true,
  showRecharge: true,
  showInviteCode: true,
  showBilling: true,
  showApiConfig: false,
  requireInviteCodeOnSignup: false,
  usePlatformProviderConfig: true,
}

function cloneDeploymentFeatures(features: DeploymentFeatures): DeploymentFeatures {
  return { ...features }
}

export function getDeploymentFeatures(config: DeploymentConfig): DeploymentFeatures {
  return cloneDeploymentFeatures(config.edition === 'cloud'
    ? CLOUD_DEPLOYMENT_FEATURES
    : SELF_HOSTED_DEPLOYMENT_FEATURES)
}

export function toPublicDeploymentFeatures(features: DeploymentFeatures): DeploymentFeatures {
  return cloneDeploymentFeatures(features)
}
