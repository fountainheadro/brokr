# ==============================================================================
# BROKR — Phase 4 Stage A Budget-Efficient Production Infrastructure (Terraform)
# ==============================================================================
# Explicitly included in Stage A:
#   - 1 Cloud Run v2 Service (europe-west3, min_instances=0, max_instances=3)
#   - Artifact Registry repo with automatic old-image cleanup
#   - Least-privilege Runtime SA & Backup SA
#   - Secret Manager secret shells (values managed out-of-band, never in state)
#   - Dedicated GCS Backup Bucket (30-day retention, public access prevented)
#   - Daily Cloud Scheduler Firestore export job (within 3 free jobs)
#   - Cloud Monitoring 5xx alert + optional $25/$50/$100 Billing Budget alerts
#
# Explicitly DEFERRED (NOT provisioned in Stage A):
#   - Memorystore Redis (~$36-$72/mo)
#   - Global External HTTPS Load Balancer + Cloud CDN (~$18.25+/mo)
#   - Multi-service Cloud Run worker splits
#   - Dedicated Search Engine & Multi-Region Compute
# ==============================================================================

locals {
  service_name = "brokr-core-api-${var.environment}"
  common_labels = {
    app         = "brokr"
    environment = var.environment
    stage       = "stage-a"
    managed_by  = "terraform"
  }
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
  ])
  core_secret_ids = toset([
    "brokr-${var.environment}-gemini-api-key",
    "brokr-${var.environment}-storage-signing-secret",
  ])
  stripe_secret_ids = var.enable_stripe_secrets ? toset([
    "brokr-${var.environment}-stripe-secret-key",
    "brokr-${var.environment}-stripe-webhook-secret",
  ]) : toset([])
  all_secret_ids = setunion(local.core_secret_ids, local.stripe_secret_ids)
}

# 1. Enable required Google Cloud APIs (idempotent; disable_on_destroy = false protects live project)
resource "google_project_service" "required" {
  for_each           = local.required_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# 2. Artifact Registry repository with retention policy (keeps storage near $0)
resource "google_artifact_registry_repository" "apps" {
  project       = var.project_id
  location      = var.region
  repository_id = "brokr-apps"
  description   = "BROKR Stage A container images"
  format        = "DOCKER"
  labels        = local.common_labels

  cleanup_policies {
    id     = "keep-recent-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.required]
}

# 3. Least-Privilege Runtime Service Account for Cloud Run
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "brokr-runtime-${var.environment}"
  display_name = "BROKR Core API Runtime (${var.environment})"
  description  = "Least-privilege Cloud Run runtime identity for BROKR ${var.environment}"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "runtime_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Scoped object access strictly to the existing application storage bucket
resource "google_storage_bucket_iam_member" "runtime_app_bucket" {
  bucket = var.app_storage_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# 4. Secret Manager Shells (Zero secret values in Terraform files or state)
resource "google_secret_manager_secret" "app_secrets" {
  for_each  = local.all_secret_ids
  project   = var.project_id
  secret_id = each.value
  labels    = local.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime_secret_access" {
  for_each  = google_secret_manager_secret.app_secrets
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# 5. Dedicated Firestore Backup Bucket + Least-Privilege Backup Service Account
resource "google_storage_bucket" "firestore_backups" {
  count                       = var.enable_daily_firestore_backup ? 1 : 0
  project                     = var.project_id
  name                        = var.backup_bucket_name
  location                    = var.backup_bucket_location
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.common_labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 3
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "backup" {
  count        = var.enable_daily_firestore_backup ? 1 : 0
  project      = var.project_id
  account_id   = "brokr-backup-${var.environment}"
  display_name = "BROKR Firestore Backup Scheduler (${var.environment})"
  description  = "Scoped SA executing daily managed Firestore exports to GCS"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "backup_firestore_export" {
  count   = var.enable_daily_firestore_backup ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.backup[0].email}"
}

resource "google_storage_bucket_iam_member" "backup_bucket_admin" {
  count  = var.enable_daily_firestore_backup ? 1 : 0
  bucket = google_storage_bucket.firestore_backups[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.backup[0].email}"
}

# Daily automated Firestore managed export (1 of 3 free GCP Cloud Scheduler jobs)
resource "google_cloud_scheduler_job" "daily_firestore_export" {
  count       = var.enable_daily_firestore_backup ? 1 : 0
  project     = var.project_id
  region      = var.region
  name        = "brokr-${var.environment}-daily-firestore-export"
  description = "Daily managed Firestore export for ${var.firestore_database_id} to GCS backup bucket"
  schedule    = var.backup_schedule_cron
  time_zone   = var.backup_timezone

  http_target {
    http_method = "POST"
    uri         = "https://firestore.googleapis.com/v1/projects/${var.project_id}/databases/${var.firestore_database_id}:exportDocuments"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({
      outputUriPrefix = "gs://${var.backup_bucket_name}/daily"
    }))

    oauth_token {
      service_account_email = google_service_account.backup[0].email
      scope                 = "https://www.googleapis.com/auth/datastore"
    }
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.backup_firestore_export,
    google_storage_bucket_iam_member.backup_bucket_admin,
  ]
}

# Optional Firestore PITR guard (import existing database first before setting manage_firestore_pitr = true)
resource "google_firestore_database" "existing_pitr" {
  count                           = var.manage_firestore_pitr ? 1 : 0
  project                         = var.project_id
  name                            = var.firestore_database_id
  location_id                     = var.region
  type                            = "FIRESTORE_NATIVE"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state         = "DELETE_PROTECTION_ENABLED"

  lifecycle {
    prevent_destroy = true
  }
}

# 6. Single Cloud Run v2 Service (Stage A — Budget-First)
resource "google_cloud_run_v2_service" "core_api" {
  project             = var.project_id
  name                = local.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.environment == "prod"
  labels              = local.common_labels

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = var.container_concurrency
    timeout                          = "300s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.container_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = var.firestore_database_id
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = var.app_storage_bucket_name
      }
      env {
        name  = "GCS_BUCKET_LOCATION"
        value = var.region
      }
      env {
        name  = "FIRESTORE_BACKUP_BUCKET"
        value = var.backup_bucket_name
      }
      env {
        name  = "USE_GCP_METADATA_AUTH"
        value = "true"
      }
      env {
        name  = "TRUST_PROXY_HOPS"
        value = "1"
      }
      env {
        name  = "SHUTDOWN_TIMEOUT_MS"
        value = "10000"
      }
      env {
        name  = "PLATFORM_ROOT_DOMAIN"
        value = var.platform_root_domain
      }
      env {
        name  = "PLATFORM_PUBLIC_URL"
        value = var.platform_public_url
      }
      env {
        name  = "ALLOW_PREVIEW_MODE_IN_PRODUCTION"
        value = "false"
      }
      env {
        name  = "ALLOW_EPHEMERAL_STORAGE_SECRET"
        value = "false"
      }
      env {
        name  = "ALLOW_MOCK_BILLING_IN_PRODUCTION"
        value = var.allow_mock_billing_in_production ? "true" : "false"
      }
      env {
        name  = "ENABLE_IN_PROCESS_SCHEDULERS"
        value = "false"
      }
      env {
        name  = "WORKER_OIDC_AUDIENCE"
        value = var.platform_public_url
      }
      env {
        name  = "WORKER_OIDC_ALLOWED_EMAILS"
        value = google_service_account.worker_invoker.email
      }
      env {
        name  = "SCRAPE_MAX_CONCURRENT_BROWSERS"
        value = tostring(var.scrape_max_concurrent_browsers)
      }
      env {
        name  = "SCRAPE_MAX_CONCURRENT_PER_TENANT"
        value = tostring(var.scrape_max_concurrent_per_tenant)
      }
      env {
        name  = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_secrets["brokr-${var.environment}-gemini-api-key"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "STORAGE_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app_secrets["brokr-${var.environment}-storage-signing-secret"].secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_stripe_secrets ? [1] : []
        content {
          name = "STRIPE_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app_secrets["brokr-${var.environment}-stripe-secret-key"].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_stripe_secrets ? [1] : []
        content {
          name = "STRIPE_WEBHOOK_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app_secrets["brokr-${var.environment}-stripe-webhook-secret"].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/readyz"
          port = 8080
        }
        initial_delay_seconds = 5
        timeout_seconds       = 5
        period_seconds        = 5
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/api/healthz"
          port = 8080
        }
        initial_delay_seconds = 15
        timeout_seconds       = 5
        period_seconds        = 30
        failure_threshold     = 3
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.runtime_secret_access,
  ]
}

# Allow public HTTPS traffic to the Cloud Run web app & API (auth enforced in app middleware)
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.core_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 6b. Phase 6 Backend Worker OIDC Invoker SA, Cloud Tasks Queue & Cloud Scheduler Jobs
# Stage A Budget Discipline:
# - Total Cloud Scheduler jobs = 3 (daily_firestore_export + viewing_reminders + automation_dispatch)
#   staying strictly within GCP's 3 free jobs/month ($0/mo).
# - 1 Cloud Tasks queue for transactional outbox dispatch (free up to 1M ops/month).
# - Still 1 Cloud Run service (no premature multi-service split).
resource "google_service_account" "worker_invoker" {
  project      = var.project_id
  account_id   = "brokr-worker-invoker-${var.environment}"
  display_name = "BROKR Internal Worker OIDC Invoker (${var.environment})"
  description  = "Dedicated least-privilege OIDC Service Account for Cloud Scheduler and Cloud Tasks worker endpoints"

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker_access" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.core_api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.worker_invoker.email}"
}

resource "google_cloud_tasks_queue" "outbox" {
  project  = var.project_id
  name     = "brokr-${var.environment}-outbox"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 2
  }

  retry_config {
    max_attempts  = 4
    min_backoff   = "15s"
    max_backoff   = "300s"
    max_doublings = 3
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_scheduler_job" "viewing_reminders" {
  count            = var.enable_worker_schedulers ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "brokr-${var.environment}-viewing-reminders"
  description      = "Phase 6 OIDC viewing reminders dispatch (2 of 3 free Cloud Scheduler jobs)"
  schedule         = "*/1 * * * *"
  time_zone        = var.backup_timezone
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.core_api.uri}/internal/workers/viewing-reminders"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({ source = "cloud_scheduler" }))

    oidc_token {
      service_account_email = google_service_account.worker_invoker.email
      audience              = var.platform_public_url
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_service_iam_member.worker_invoker_access,
  ]
}

resource "google_cloud_scheduler_job" "automation_dispatch" {
  count            = var.enable_worker_schedulers ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "brokr-${var.environment}-automation-dispatch"
  description      = "Phase 6 OIDC outbox + auto-crawl + agency auto-import dispatcher (3 of 3 free Cloud Scheduler jobs)"
  schedule         = "*/5 * * * *"
  time_zone        = var.backup_timezone
  attempt_deadline = "180s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.core_api.uri}/internal/workers/automation-dispatch"
    headers = {
      "Content-Type" = "application/json"
    }
    body = base64encode(jsonencode({ source = "cloud_scheduler" }))

    oidc_token {
      service_account_email = google_service_account.worker_invoker.email
      audience              = var.platform_public_url
    }
  }

  depends_on = [
    google_project_service.required,
    google_cloud_run_v2_service_iam_member.worker_invoker_access,
  ]
}

# 7. Cloud Monitoring 5xx Error Rate Alert Policy (Included in GCP Free Monitoring Tier)
resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  project               = var.project_id
  display_name          = "BROKR ${upper(var.environment)} — Cloud Run 5xx Error Spike"
  combiner              = "OR"
  notification_channels = var.alert_notification_channels

  conditions {
    display_name = "Cloud Run 5xx response count > 5 in 5 minutes"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  depends_on = [google_project_service.required]
}

# 8. Optional GCP Billing Budget Alert ($25 / $50 / $100 when monthly_budget_usd = 100)
resource "google_billing_budget" "stage_a_budget" {
  count           = var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "BROKR Stage A Monthly Budget (${var.environment})"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.25
  }
  threshold_rules {
    threshold_percent = 0.50
  }
  threshold_rules {
    threshold_percent = 1.00
  }
}
