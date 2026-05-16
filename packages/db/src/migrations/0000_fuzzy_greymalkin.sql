CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`account_state` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `content_item` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_external_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`published_at` integer,
	`content_type` text DEFAULT 'video' NOT NULL,
	`duration_seconds` integer,
	`thumbnail_url` text,
	`canonical_url` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creator`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_item_source_identity_uidx` ON `content_item` (`source_type`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `content_item_creator_id_idx` ON `content_item` (`creator_id`);--> statement-breakpoint
CREATE INDEX `content_item_published_at_idx` ON `content_item` (`published_at`);--> statement-breakpoint
CREATE TABLE `content_source` (
	`id` text PRIMARY KEY NOT NULL,
	`content_item_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_external_id` text,
	`embed_url` text,
	`native_media_url` text,
	`canonical_url` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_source_canonical_uidx` ON `content_source` (`source_type`,`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_source_item_priority_uidx` ON `content_source` (`content_item_id`,`priority`);--> statement-breakpoint
CREATE INDEX `content_source_content_item_id_idx` ON `content_source` (`content_item_id`);--> statement-breakpoint
CREATE TABLE `creator` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_external_id` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`image_url` text,
	`canonical_url` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creator_source_identity_uidx` ON `creator` (`source_type`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `creator_display_name_idx` ON `creator` (`display_name`);--> statement-breakpoint
CREATE TABLE `feed` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_external_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`description` text,
	`refresh_cadence_seconds` integer,
	`last_normal_refresh_at` integer,
	`next_refresh_after` integer,
	`adapter_metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creator`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_source_identity_uidx` ON `feed` (`source_type`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `feed_creator_id_idx` ON `feed` (`creator_id`);--> statement-breakpoint
CREATE INDEX `feed_next_refresh_after_idx` ON `feed` (`next_refresh_after`);--> statement-breakpoint
CREATE TABLE `feed_content` (
	`feed_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`source_external_id` text NOT NULL,
	`raw_import_ref` text,
	`discovered_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`feed_id`, `content_item_id`),
	FOREIGN KEY (`feed_id`) REFERENCES `feed`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_content_source_identity_uidx` ON `feed_content` (`feed_id`,`source_external_id`);--> statement-breakpoint
CREATE INDEX `feed_content_content_item_id_idx` ON `feed_content` (`content_item_id`);--> statement-breakpoint
CREATE TABLE `refresh_feed_result` (
	`id` text PRIMARY KEY NOT NULL,
	`refresh_run_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`status` text NOT NULL,
	`items_discovered_count` integer DEFAULT 0 NOT NULL,
	`items_created_count` integer DEFAULT 0 NOT NULL,
	`items_updated_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`error_summary_json` text,
	FOREIGN KEY (`refresh_run_id`) REFERENCES `refresh_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feed`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_feed_result_run_feed_uidx` ON `refresh_feed_result` (`refresh_run_id`,`feed_id`);--> statement-breakpoint
CREATE INDEX `refresh_feed_result_feed_id_idx` ON `refresh_feed_result` (`feed_id`);--> statement-breakpoint
CREATE TABLE `refresh_run` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`force` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`requested_creator_id` text,
	`requested_feed_id` text,
	`feeds_requested_count` integer DEFAULT 0 NOT NULL,
	`feeds_skipped_count` integer DEFAULT 0 NOT NULL,
	`feeds_succeeded_count` integer DEFAULT 0 NOT NULL,
	`feeds_failed_count` integer DEFAULT 0 NOT NULL,
	`items_discovered_count` integer DEFAULT 0 NOT NULL,
	`items_created_count` integer DEFAULT 0 NOT NULL,
	`items_updated_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`error_summary_json` text,
	FOREIGN KEY (`requested_creator_id`) REFERENCES `creator`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_feed_id`) REFERENCES `feed`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `refresh_run_status_started_at_idx` ON `refresh_run` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `refresh_run_requested_creator_id_idx` ON `refresh_run` (`requested_creator_id`);--> statement-breakpoint
CREATE INDEX `refresh_run_requested_feed_id_idx` ON `refresh_run` (`requested_feed_id`);--> statement-breakpoint
CREATE TABLE `content_status` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`status` text NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_status_user_item_status_uidx` ON `content_status` (`user_id`,`content_item_id`,`status`);--> statement-breakpoint
CREATE INDEX `content_status_content_item_id_idx` ON `content_status` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `content_status_user_status_idx` ON `content_status` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `migration_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`migration_run_id` text NOT NULL,
	`old_entity_type` text NOT NULL,
	`old_entity_id` text NOT NULL,
	`new_entity_type` text NOT NULL,
	`new_entity_id` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`message` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`migration_run_id`) REFERENCES `migration_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `migration_mapping_run_old_entity_uidx` ON `migration_mapping` (`migration_run_id`,`old_entity_type`,`old_entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `migration_mapping_run_new_entity_uidx` ON `migration_mapping` (`migration_run_id`,`new_entity_type`,`new_entity_id`);--> statement-breakpoint
CREATE INDEX `migration_mapping_new_entity_idx` ON `migration_mapping` (`new_entity_type`,`new_entity_id`);--> statement-breakpoint
CREATE TABLE `migration_run` (
	`id` text PRIMARY KEY NOT NULL,
	`source_export_fingerprint` text NOT NULL,
	`source_filename` text,
	`status` text NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`users_imported_count` integer DEFAULT 0 NOT NULL,
	`creators_imported_count` integer DEFAULT 0 NOT NULL,
	`feeds_imported_count` integer DEFAULT 0 NOT NULL,
	`content_items_imported_count` integer DEFAULT 0 NOT NULL,
	`subscriptions_imported_count` integer DEFAULT 0 NOT NULL,
	`playlists_imported_count` integer DEFAULT 0 NOT NULL,
	`warnings_json` text,
	`failures_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `migration_run_source_fingerprint_uidx` ON `migration_run` (`source_export_fingerprint`);--> statement-breakpoint
CREATE INDEX `migration_run_status_started_at_idx` ON `migration_run` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `playlist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_mode` text DEFAULT 'manual' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlist_id_user_uidx` ON `playlist` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `playlist_user_position_idx` ON `playlist` (`user_id`,`position`);--> statement-breakpoint
CREATE INDEX `playlist_user_name_idx` ON `playlist` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `playlist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`playlist_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlist`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playlist_id`,`user_id`) REFERENCES `playlist`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlist_item_playlist_position_uidx` ON `playlist_item` (`playlist_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `playlist_item_playlist_content_uidx` ON `playlist_item` (`playlist_id`,`content_item_id`);--> statement-breakpoint
CREATE INDEX `playlist_item_user_id_idx` ON `playlist_item` (`user_id`);--> statement-breakpoint
CREATE INDEX `playlist_item_content_item_id_idx` ON `playlist_item` (`content_item_id`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`title_override` text,
	`settings_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `creator`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_user_creator_uidx` ON `subscription` (`user_id`,`creator_id`);--> statement-breakpoint
CREATE INDEX `subscription_creator_id_idx` ON `subscription` (`creator_id`);--> statement-breakpoint
CREATE TABLE `user_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_setting_user_key_uidx` ON `user_setting` (`user_id`,`key`);