-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `webhookUrl` TEXT NULL,
    `webhookSecret` VARCHAR(191) NULL,
    `apiKeyHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Tenant_apiKeyHash_key`(`apiKeyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Agent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `systemPrompt` TEXT NOT NULL,
    `model` VARCHAR(191) NOT NULL DEFAULT 'deepseek-chat',
    `temperature` DOUBLE NOT NULL DEFAULT 0.7,
    `isRoutable` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `builtinTools` TEXT NOT NULL,
    `customTools` TEXT NOT NULL,
    `mcpServers` TEXT NOT NULL,
    `handoffRules` TEXT NOT NULL,
    `guardrails` TEXT NOT NULL,
    `knowledge` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Agent_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bucket` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `embeddingProvider` VARCHAR(191) NOT NULL,
    `embeddingModel` VARCHAR(191) NOT NULL,
    `embeddingDim` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Bucket_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `bucketId` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `source` TEXT NOT NULL,
    `metadata` TEXT NOT NULL,
    `chunkCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Document_bucketId_idx`(`bucketId`),
    INDEX `Document_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Agent` ADD CONSTRAINT `Agent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bucket` ADD CONSTRAINT `Bucket_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_bucketId_fkey` FOREIGN KEY (`bucketId`) REFERENCES `Bucket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
