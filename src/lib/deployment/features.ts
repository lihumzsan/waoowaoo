import type { DeploymentConfig } from './config'
import { isUserProviderCredentialMode } from './config'

export type PasswordAuthIdentity = 'username' | 'phone'

export interface DeploymentFeatures {
  showOfficialPublicPages: boolean
  showLegalPages: boolean
  showApiConfig: boolean
  showAccountSecurity: boolean
  showGoogleOAuth: boolean
  showWechatOfficialAuth: boolean
  enablePhoneAuth: boolean
  enablePasswordAuth: boolean
  passwordAuthIdentity: PasswordAuthIdentity
  showDownloadLogs: boolean
  showUpdateCheck: boolean
  showBetaBadge: boolean
}

type EditionDeploymentFeatures = Omit<DeploymentFeatures, 'showApiConfig'>

const SELF_HOSTED_DEPLOYMENT_FEATURES: EditionDeploymentFeatures = {
  showOfficialPublicPages: false,
  showLegalPages: false,
  showAccountSecurity: false,
  showGoogleOAuth: false,
  showWechatOfficialAuth: false,
  enablePhoneAuth: false,
  enablePasswordAuth: true,
  passwordAuthIdentity: 'username',
  showDownloadLogs: false,
  showUpdateCheck: true,
  showBetaBadge: false,
}

const CLOUD_DEPLOYMENT_FEATURES: EditionDeploymentFeatures = {
  showOfficialPublicPages: true,
  showLegalPages: true,
  showAccountSecurity: true,
  showGoogleOAuth: true,
  showWechatOfficialAuth: true,
  enablePhoneAuth: false,
  enablePasswordAuth: true,
  passwordAuthIdentity: 'phone',
  showDownloadLogs: false,
  showUpdateCheck: false,
  showBetaBadge: true,
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
  }
}

export function toPublicDeploymentFeatures(features: DeploymentFeatures): DeploymentFeatures {
  return { ...features }
}
