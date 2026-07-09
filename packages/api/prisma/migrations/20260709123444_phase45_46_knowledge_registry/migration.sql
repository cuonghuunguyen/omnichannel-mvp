-- Phase 45/46 knowledge-registry schema changes.
-- These columns/tables were added to schema.prisma (commits 078980e "45-01" and
-- 21c7f96 "46-01") but no migration was ever generated, so the deployed client
-- selected columns the DB lacked → every /knowledge/* request 503'd. This
-- migration is the exact `prisma migrate diff` output that reconciles the two.

-- AlterTable
ALTER TABLE `Bucket` ADD COLUMN `avgChunkLength` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `relevanceFloorOverride` DOUBLE NULL;

-- AlterTable
ALTER TABLE `Document` ADD COLUMN `contentHash` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `DocumentVersion` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `chunkCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentVersion_documentId_createdAt_idx`(`documentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Document_bucketId_contentHash_key` ON `Document`(`bucketId`, `contentHash`);

-- AddForeignKey
ALTER TABLE `DocumentVersion` ADD CONSTRAINT `DocumentVersion_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
