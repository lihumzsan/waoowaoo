import { getDeploymentConfig } from './config'
import {
  getDeploymentFeatures,
  toPublicDeploymentFeatures,
  type DeploymentFeatures,
} from './features'

export function readPublicDeploymentFeatures(): DeploymentFeatures {
  return toPublicDeploymentFeatures(getDeploymentFeatures(getDeploymentConfig()))
}
