ALTER TABLE `creator` ADD `last_content_published_at` integer;--> statement-breakpoint
CREATE INDEX `creator_last_content_published_at_idx` ON `creator` (`last_content_published_at`);--> statement-breakpoint
UPDATE `creator` SET `last_content_published_at` = (SELECT MAX(`published_at`) FROM `content_item` WHERE `content_item`.`creator_id` = `creator`.`id`);
