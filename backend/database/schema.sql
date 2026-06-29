-- =====================================================================
-- CRM Multi-Tenant — Main (shared) database schema
-- Run this in phpMyAdmin (http://localhost/phpmyadmin) or via:
--   mysql -u root < database/schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `crm_main`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `crm_main`;

-- ---------------------------------------------------------------------
-- Tenants (clients)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `clients` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255) NOT NULL,
  `email`       VARCHAR(255) DEFAULT NULL,
  `phone`       VARCHAR(50)  DEFAULT NULL,
  `avatar`      VARCHAR(255) DEFAULT NULL,
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'active',
  `subdomain`   VARCHAR(255) DEFAULT NULL,
  `db_name`     VARCHAR(255) NOT NULL,
  `db_username` VARCHAR(255) NOT NULL,
  `db_password` VARCHAR(255) DEFAULT NULL,
  `plan`        VARCHAR(100) NOT NULL DEFAULT 'starter',
  `plan_start`  DATE DEFAULT NULL,
  `plan_end`    DATE DEFAULT NULL,
  `created_at`  DATETIME DEFAULT NULL,
  `updated_at`  DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clients_db_name` (`db_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Platform users: super admins (client_id NULL) and client admins
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255) DEFAULT NULL,
  `avatar`     VARCHAR(255) DEFAULT NULL,
  `email`      VARCHAR(255) NOT NULL,
  `password`   VARCHAR(255) NOT NULL,
  `role`       VARCHAR(50)  NOT NULL,
  `client_id`  INT UNSIGNED DEFAULT NULL,
  `created_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email` (`email`),
  KEY `users_client_id` (`client_id`),
  CONSTRAINT `users_client_fk` FOREIGN KEY (`client_id`)
    REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Per-client feature entitlements
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `client_features` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`   INT UNSIGNED NOT NULL,
  `feature_key` VARCHAR(100) NOT NULL,
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME DEFAULT NULL,
  `updated_at`  DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_feature_unique` (`client_id`, `feature_key`),
  CONSTRAINT `client_features_fk` FOREIGN KEY (`client_id`)
    REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Role -> permission mapping
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `permissions` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role`           VARCHAR(50)  NOT NULL,
  `permission_key` VARCHAR(100) NOT NULL,
  `description`    VARCHAR(255) DEFAULT NULL,
  `created_at`     DATETIME DEFAULT NULL,
  `updated_at`     DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `permissions_role_key` (`role`, `permission_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Per-client CRM settings (key/value). Note: `setting_key`/`setting_value`
-- avoid the MySQL reserved word `key`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`     INT UNSIGNED NOT NULL,
  `setting_key`   VARCHAR(100) NOT NULL,
  `setting_value` TEXT DEFAULT NULL,
  `created_at`    DATETIME DEFAULT NULL,
  `updated_at`    DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `settings_client_key` (`client_id`, `setting_key`),
  CONSTRAINT `settings_client_fk` FOREIGN KEY (`client_id`)
    REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Global landing-page content, managed by the super admin (key/value).
-- Unlike `settings`, this is platform-wide (no client_id) and powers the
-- public marketing site: logo, company name, pricing plans, testimonials.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `landing_settings` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key`   VARCHAR(100) NOT NULL,
  `setting_value` LONGTEXT DEFAULT NULL,
  `created_at`    DATETIME DEFAULT NULL,
  `updated_at`    DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `landing_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Public "Contact us" messages (submitted from the landing page)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contact_messages` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255) NOT NULL,
  `email`      VARCHAR(255) NOT NULL,
  `company`    VARCHAR(255) DEFAULT NULL,
  `message`    TEXT NOT NULL,
  `status`     VARCHAR(20) NOT NULL DEFAULT 'new',
  `created_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `contact_messages_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Public "Request a demo" submissions (from the /demo page)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `demo_requests` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255) NOT NULL,
  `email`      VARCHAR(255) NOT NULL,
  `company`    VARCHAR(255) DEFAULT NULL,
  `phone`      VARCHAR(50)  DEFAULT NULL,
  `team_size`  VARCHAR(50)  DEFAULT NULL,
  `interest`   VARCHAR(100) DEFAULT NULL,
  `message`    TEXT DEFAULT NULL,
  `status`     VARCHAR(20) NOT NULL DEFAULT 'new',
  `created_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `demo_requests_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
