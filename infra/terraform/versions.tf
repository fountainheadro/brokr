terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Uncomment after creating your GCS Terraform state bucket once:
  #   gsutil mb -p brokr-42038 -l europe-west3 -b on gs://brokr-42038-tfstate
  #   gsutil versioning set on gs://brokr-42038-tfstate
  #
  # backend "gcs" {
  #   bucket = "brokr-42038-tfstate"
  #   prefix = "stage-a/prod"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
