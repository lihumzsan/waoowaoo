import type { DeploymentConfig } from './config'
import { isPlatformProviderCredentialMode, isUserProviderCredentialMode } from './config'

export interface DeploymentFeatures {
  showOfficialPublicPages: boolean
  showPricingPage: boolean
  showLegalPages: boolean
  showRecharge: boolean
  showInviteCode: boolean
  showBilling: boolean
  showApiConfig: boolean
  showAccountSecurity: boolean
  showGoogleOAuth: boolean
  enablePhoneAuth: boolean
  enablePasswordAuth: boolean
  showDownloadLogs: boolean
  showUpdateCheck: boolean
  requireInviteCodeOnSignup: boolean
  usePlatformProviderConfig: boolean
}

type EditionDeploymentFeatures = Omit<DeploymentFeatures, 'showApiConfig' | 'usePlatformProviderConfig'>

const SELF_HOSTED_DEPLOYMENT_FEATURES: EditionDeploymentFeatures = {
  showOfficialPublicPages: false,
  showPricingPage: false,
  showLegalPages: false,
  showRecharge: false,
  showInviteCode: false,
  showBilling: false,
  showAccountSecurity: false,
  showGoogleOAuth: false,
  enablePhoneAuth: false,
  enablePasswordAuth: true,
  showDownloadLogs: false,
  showUpdateCheck: true,
  requireInviteCodeOnSignup: false,
}

const CLOUD_DEPLOYMENT_FEATURES: EditionDeploymentFeatures = {
  showOfficialPublicPages: true,
  showPricingPage: true,
  showLegalPages: true,
  showRecharge: true,
  showInviteCode: true,
  showBilling: true,
  showAccountSecurity: true,
  showGoogleOAuth: true,
  enablePhoneAuth: true,
  enablePasswordAuth: false,
  showDownloadLogs: false,
  showUpdateCheck: false,
  requireInviteCodeOnSignup: false,
}

function cloneEditionDeploymentFeatures(features: EditionDeploymentFeatures): EditionDeploymentFeatures {
  return { ...features }
}

export function getDeploymentFeatures(config: DeploymentConfig): DeploymentFeatures {
  const base = cloneEditionDeploymentFeatures(config.edition === 'cloud'
    ? CLOUD_DEPLOYMENT_FEATURES
    : SELF_HOSTED_DEPLOYMENT_FEATURES)
  return {
    ...base,
    showApiConfig: isUserProviderCredentialMode(config),
    usePlatformProviderConfig: isPlatformProviderCredentialMode(config),
  }
}

export function toPublicDeploymentFeatures(features: DeploymentFeatures): DeploymentFeatures {
  return { ...features }
}
