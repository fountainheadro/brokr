import path from "path";
import fs from "fs";
import { GcpAuthService } from "../gcp/svc_gcp-auth";
import { logger } from "../logger/logger";

export interface ProductionValidationOptions {
  verifiedFirestoreAccess?: boolean;
  verifiedGcsAccess?: boolean;
}

export interface ProductionValidationReport {
  valid: boolean;
  environment: string;
  isProduction: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    geminiApiKeyConfigured: boolean;
    stripeBillingConfigured: boolean;
    mockBillingBlocked: boolean;
    previewModeDisabledByDefault: boolean;
    twilioConfigConsistent: boolean;
    firebaseProjectConfigured: boolean;
    adcMetadataEnabled: boolean;
    localAdcConfigured: boolean;
    serviceAccountConfigured: boolean;
    gcpAuthCredentialsPresent: boolean;
    firestoreAccessVerified: boolean;
    gcsAccessVerified: boolean;
    firestoreServerAuthConfigured: boolean;
    platformDomainConfigured: boolean;
    gcsStorageConfigured: boolean;
    infrastructureVerified: boolean;
    storageSigningSecretConfigured: boolean;
  };
}

let verifiedInfraState: {
  firestoreVerified: boolean;
  gcsVerified: boolean;
  verifiedAt: string | null;
} = {
  firestoreVerified: false,
  gcsVerified: false,
  verifiedAt: null,
};

export function setVerifiedInfrastructureStatus(status: {
  firestoreVerified: boolean;
  gcsVerified: boolean;
}): void {
  verifiedInfraState = {
    firestoreVerified: status.firestoreVerified,
    gcsVerified: status.gcsVerified,
    verifiedAt: new Date().toISOString(),
  };
}

export function clearVerifiedInfrastructureStatus(): void {
  verifiedInfraState = {
    firestoreVerified: false,
    gcsVerified: false,
    verifiedAt: null,
  };
}

export function validateProductionEnvironment(
  env: Record<string, string | undefined> = process.env,
  options?: ProductionValidationOptions
): ProductionValidationReport {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  const geminiApiKeyConfigured = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
  const stripeSecretConfigured = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.trim().length > 0);
  const stripeWebhookConfigured = Boolean(
    env.STRIPE_WEBHOOK_SECRET && env.STRIPE_WEBHOOK_SECRET.trim().length > 0
  );
  const stripeBillingConfigured = stripeSecretConfigured && stripeWebhookConfigured;
  const allowMockBillingInProd = env.ALLOW_MOCK_BILLING_IN_PRODUCTION === "true";
  const mockBillingBlocked = !allowMockBillingInProd;

  const previewAllowedInProd = env.ALLOW_PREVIEW_MODE_IN_PRODUCTION === "true";
  const previewModeDisabledByDefault = !previewAllowedInProd;

  const twilioSid = env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = env.TWILIO_AUTH_TOKEN?.trim();
  const twilioPhone = env.TWILIO_PHONE_NUMBER?.trim();
  const hasPartialTwilio = Boolean(twilioSid || twilioToken || twilioPhone);
  const twilioConfigConsistent = !hasPartialTwilio || Boolean(twilioSid && twilioToken);

  let firebaseProjectConfigured = Boolean(
    env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.VITE_FIREBASE_PROJECT_ID
  );
  let gcsBucketFromConfig = false;
  try {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (parsed?.projectId) firebaseProjectConfigured = true;
      if (parsed?.storageBucket) gcsBucketFromConfig = true;
    }
  } catch {
    // Ignore read failure
  }

  const adcMetadataEnabled = GcpAuthService.isMetadataAuthEnabled(env);
  const serviceAccountConfigured = Boolean(GcpAuthService.getServiceAccountCreds(env));
  const localAdcConfigured = Boolean(GcpAuthService.getAdcAuthorizedUserCreds(env));
  const gcpAuthCredentialsPresent =
    adcMetadataEnabled || serviceAccountConfigured || localAdcConfigured;

  const firestoreAccessVerified = Boolean(
    options?.verifiedFirestoreAccess ?? verifiedInfraState.firestoreVerified
  );
  const gcsAccessVerified = Boolean(
    options?.verifiedGcsAccess ?? verifiedInfraState.gcsVerified
  );

  const firestoreServerAuthConfigured = gcpAuthCredentialsPresent && firestoreAccessVerified;

  const platformDomainConfigured = Boolean(
    (env.PLATFORM_ROOT_DOMAIN && env.PLATFORM_ROOT_DOMAIN.trim()) ||
      (env.APP_URL && !env.APP_URL.includes("localhost"))
  );

  const gcsBucketConfigured = Boolean(env.GCS_BUCKET_NAME?.trim() || gcsBucketFromConfig);
  const gcsStorageConfigured =
    gcsBucketConfigured && gcpAuthCredentialsPresent && gcsAccessVerified;
  const infrastructureVerified = firestoreAccessVerified && gcsAccessVerified;

  const storageSigningSecretConfigured = Boolean(
    env.STORAGE_SIGNING_SECRET?.trim() || env.SESSION_SECRET?.trim()
  );

  if (isProduction) {
    if (!geminiApiKeyConfigured) {
      errors.push("GEMINI_API_KEY lipsește în mediul de producție.");
    }
    if (!allowMockBillingInProd && !stripeBillingConfigured) {
      errors.push(
        "STRIPE_SECRET_KEY și STRIPE_WEBHOOK_SECRET sunt obligatorii în producție (ALLOW_MOCK_BILLING_IN_PRODUCTION nu este activat)."
      );
    }
    if (!twilioConfigConsistent) {
      errors.push(
        "Configurație Twilio incompletă: TWILIO_ACCOUNT_SID și TWILIO_AUTH_TOKEN trebuie setate împreună."
      );
    }
    if (!firebaseProjectConfigured) {
      errors.push(
        "Proiectul Firebase (FIREBASE_PROJECT_ID sau firebase-applet-config.json) nu este configurat."
      );
    }
    if (previewAllowedInProd) {
      warnings.push(
        "ALLOW_PREVIEW_MODE_IN_PRODUCTION=true este activat în producție — dezactivați după verificare."
      );
    }
    if (!gcpAuthCredentialsPresent) {
      warnings.push(
        "Credențialele Google Cloud ADC lipsesc (activați USE_GCP_METADATA_AUTH=true în Cloud Run sau configurați ADC local / GOOGLE_APPLICATION_CREDENTIALS); persistența Firestore în producție este blocată fără fallback local."
      );
    } else if (!firestoreAccessVerified) {
      warnings.push(
        "Credențialele ADC pentru Firestore sunt prezente, dar accesul real nu a fost încă verificat (/api/platform/migration/infra-status)."
      );
    }
    if (!platformDomainConfigured) {
      warnings.push(
        "PLATFORM_ROOT_DOMAIN / APP_URL nu este setat pe domeniu de producție."
      );
    }
    if (!gcsBucketConfigured || !gcpAuthCredentialsPresent) {
      warnings.push(
        "Cloud Storage (GCS_BUCKET_NAME + credențiale ADC) nu este activ; încărcările de fișiere folosesc stocarea locală izolată."
      );
    } else if (!gcsAccessVerified) {
      warnings.push(
        "Credențialele ADC și bucket-ul GCS sunt prezente, dar accesul real la bucket nu a fost încă verificat."
      );
    }
    if (!storageSigningSecretConfigured) {
      warnings.push(
        "STORAGE_SIGNING_SECRET lipsește; linkurile semnate de descărcare nu vor supraviețui între instanțe/restarturi."
      );
    }
  } else {
    if (!geminiApiKeyConfigured) {
      warnings.push("GEMINI_API_KEY lipsește în mediul curent (funcțiile AI vor folosi fallback/eroare).");
    }
    if (!twilioConfigConsistent) {
      warnings.push("Configurație Twilio parțială (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).");
    }
  }

  return {
    valid: errors.length === 0,
    environment: nodeEnv,
    isProduction,
    errors,
    warnings,
    checks: {
      geminiApiKeyConfigured,
      stripeBillingConfigured,
      mockBillingBlocked,
      previewModeDisabledByDefault,
      twilioConfigConsistent,
      firebaseProjectConfigured,
      adcMetadataEnabled,
      localAdcConfigured,
      serviceAccountConfigured,
      gcpAuthCredentialsPresent,
      firestoreAccessVerified,
      gcsAccessVerified,
      firestoreServerAuthConfigured,
      platformDomainConfigured,
      gcsStorageConfigured,
      infrastructureVerified,
      storageSigningSecretConfigured,
    },
  };
}

export function assertProductionEnvironment(
  env: Record<string, string | undefined> = process.env
): ProductionValidationReport {
  const report = validateProductionEnvironment(env);

  for (const warning of report.warnings) {
    logger.warn(`[Startup Config] ${warning}`, { module: "production-config" });
  }

  if (!report.valid) {
    for (const err of report.errors) {
      logger.error(`[Startup Config Error] ${err}`, undefined, { module: "production-config" });
    }
    throw new Error(
      `Configurare invalidă pentru mediul ${report.environment}: ${report.errors.join(" | ")}`
    );
  }

  return report;
}
