output "cloud_run_service_name" {
  description = "Provisioned Cloud Run v2 service name"
  value       = google_cloud_run_v2_service.core_api.name
}

output "cloud_run_service_url" {
  description = "Live HTTPS URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.core_api.uri
}

output "runtime_service_account_email" {
  description = "Least-privilege Cloud Run runtime Service Account email"
  value       = google_service_account.runtime.email
}

output "backup_service_account_email" {
  description = "Least-privilege Firestore backup Service Account email"
  value       = var.enable_daily_firestore_backup ? google_service_account.backup[0].email : null
}

output "backup_bucket_uri" {
  description = "GCS URI where automated daily Firestore backups are stored"
  value       = var.enable_daily_firestore_backup ? "gs://${google_storage_bucket.firestore_backups[0].name}" : null
}

output "secret_manager_ids" {
  description = "Secret Manager secret IDs to populate via 'gcloud secrets versions add'"
  value       = [for s in google_secret_manager_secret.app_secrets : s.secret_id]
}

output "rollback_command_template" {
  description = "Instant < 2 minute Cloud Run revision rollback command"
  value       = "gcloud run services update-traffic ${google_cloud_run_v2_service.core_api.name} --project=${var.project_id} --region=${var.region} --to-revisions=<PREVIOUS_REVISION>=100"
}
