variable "project_id" {
  description = "Google Cloud / Firebase Project ID"
  type        = string
  default     = "brokr-42038"
}

variable "region" {
  description = "Primary European Cloud Run & Artifact Registry region"
  type        = string
  default     = "europe-west3"
}

variable "environment" {
  description = "Deployment environment label (staging or prod)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be either 'staging' or 'prod'."
  }
}

variable "firestore_database_id" {
  description = "Existing Cloud Firestore database ID (all live leads, cereri, contacts, and tenants)"
  type        = string
  default     = "ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434"
}

variable "app_storage_bucket_name" {
  description = "Existing Firebase / Cloud Storage bucket used for agency files and media"
  type        = string
  default     = "brokr-42038.firebasestorage.app"
}

variable "backup_bucket_name" {
  description = "Dedicated GCS bucket for automated daily Firestore backup exports"
  type        = string
  default     = "brokr-42038-firestore-backups"
}

variable "backup_bucket_location" {
  description = "GCS location for Firestore backup exports (EU multi-region recommended for DR)"
  type        = string
  default     = "EU"
}

variable "container_image" {
  description = "Immutable Artifact Registry container image URI (prefer @sha256 digest)"
  type        = string
}

variable "platform_root_domain" {
  description = "Root SaaS domain for multi-tenant subdomain routing"
  type        = string
  default     = "highline.ro"
}

variable "platform_public_url" {
  description = "Canonical HTTPS root URL"
  type        = string
  default     = "https://highline.ro"
}

variable "min_instances" {
  description = "Cloud Run minimum instances (0 recommended for Stage A pilot budget; 1 eliminates cold starts)"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Cloud Run maximum instances cap to bound burst spend in Stage A"
  type        = number
  default     = 3
}

variable "container_concurrency" {
  description = "Max concurrent HTTP requests per Cloud Run container instance"
  type        = number
  default     = 40
}

variable "cpu_limit" {
  description = "vCPU allocation per Cloud Run instance"
  type        = string
  default     = "2"
}

variable "memory_limit" {
  description = "Memory allocation per Cloud Run instance (2Gi accommodates in-process Puppeteer in Stage A)"
  type        = string
  default     = "2Gi"
}

variable "allow_mock_billing_in_production" {
  description = "Allow mock billing until live Stripe keys are populated in Secret Manager"
  type        = bool
  default     = true
}

variable "enable_stripe_secrets" {
  description = "Mount STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET from Secret Manager into Cloud Run"
  type        = bool
  default     = false
}

variable "enable_daily_firestore_backup" {
  description = "Provision daily Cloud Scheduler job exporting Firestore to GCS (1 of 3 free GCP jobs)"
  type        = bool
  default     = true
}

variable "backup_schedule_cron" {
  description = "Cron schedule for automated daily Firestore backup exports"
  type        = string
  default     = "0 3 * * *"
}

variable "backup_timezone" {
  description = "Timezone for backup scheduler"
  type        = string
  default     = "Europe/Bucharest"
}

variable "manage_firestore_pitr" {
  description = "Set true ONLY after importing existing Firestore DB via terraform import so existing live data is never touched"
  type        = bool
  default     = false
}

variable "alert_notification_channels" {
  description = "Optional Cloud Monitoring notification channel resource names for 5xx alerts"
  type        = list(string)
  default     = []
}

variable "billing_account_id" {
  description = "Optional GCP Billing Account ID (e.g. 012345-6789AB-CDEF01) to provision $25/$50/$100 budget alerts"
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Base monthly budget amount in USD (alerts trigger at 25%, 50%, and 100%)"
  type        = number
  default     = 100
}
