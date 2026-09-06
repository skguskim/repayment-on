CREATE TABLE `ai_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`lease_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_requests_created` ON `ai_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_requests_client_created` ON `ai_requests` (`client_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_requests_lease` ON `ai_requests` (`lease_until`);