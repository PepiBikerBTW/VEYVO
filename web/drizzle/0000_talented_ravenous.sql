CREATE TABLE `accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`secret` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
