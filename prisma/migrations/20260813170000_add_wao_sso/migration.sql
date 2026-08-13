CREATE TABLE `wao_sso_authorization_codes` (
  `id` VARCHAR(191) NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `clientId` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `redirectUri` VARCHAR(512) NOT NULL,
  `scope` VARCHAR(255) NOT NULL,
  `codeChallenge` VARCHAR(128) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `wao_sso_authorization_codes_codeHash_key` (`codeHash`),
  INDEX `wao_sso_authorization_codes_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `wao_sso_authorization_codes_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wao_sso_authorization_codes_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `wao_sso_access_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `clientId` VARCHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `scope` VARCHAR(255) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `wao_sso_access_tokens_tokenHash_key` (`tokenHash`),
  INDEX `wao_sso_access_tokens_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `wao_sso_access_tokens_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `wao_sso_access_tokens_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
