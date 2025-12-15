CREATE TABLE `user_text_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_font_family` text DEFAULT 'tahoma',
	`default_font_size` integer DEFAULT 14,
	`default_color` text DEFAULT 'black',
	`allow_formatting` integer DEFAULT true,
	`max_message_length` integer DEFAULT 500,
	`style_presets` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `style_data` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `has_formatting` integer DEFAULT false;