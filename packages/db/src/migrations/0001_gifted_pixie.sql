CREATE TABLE `collection_member` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `creator_collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `creator`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`,`user_id`) REFERENCES `creator_collection`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_member_collection_creator_uidx` ON `collection_member` (`collection_id`,`creator_id`);--> statement-breakpoint
CREATE INDEX `collection_member_user_id_idx` ON `collection_member` (`user_id`);--> statement-breakpoint
CREATE INDEX `collection_member_creator_id_idx` ON `collection_member` (`creator_id`);--> statement-breakpoint
CREATE TABLE `creator_collection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creator_collection_id_user_uidx` ON `creator_collection` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `creator_collection_user_position_idx` ON `creator_collection` (`user_id`,`position`);--> statement-breakpoint
CREATE INDEX `creator_collection_user_name_idx` ON `creator_collection` (`user_id`,`name`);