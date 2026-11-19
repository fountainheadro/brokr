export interface AppEnvConfig {
  isProduction: boolean;
  isDevelopment: boolean;
  appUrl: string;
  geminiApiKey: string;
  googleMapsKey: string;
  firebaseVapidKey?: string;
  platformRootDomain?: string;
  platformAdminSubdomain?: string;
  platformPublicUrl?: string;
  twilio?: {
    accountSid?: string;
    authToken?: string;
    phoneNumber?: string;
  };
}

export function getEnvConfig(): AppEnvConfig {
  const isBrowser = typeof window !== "undefined";
  const nodeEnv = typeof process !== "undefined" && process.env ? process.env.NODE_ENV : "development";
  const isProduction = nodeEnv === "production";

  if (isBrowser) {
    return {
      isProduction,
      isDevelopment: !isProduction,
      appUrl: (typeof process !== "undefined" && process.env?.APP_URL) || window.location.origin,
      geminiApiKey: "",
      googleMapsKey: (typeof process !== "undefined" && (process.env?.GOOGLE_MAPS_PLATFORM_KEY || process.env?.VITE_GOOGLE_MAPS_API_KEY)) || "",
      firebaseVapidKey: typeof process !== "undefined" ? process.env?.VITE_FIREBASE_VAPID_KEY : undefined,
      platformRootDomain:
        (typeof process !== "undefined" ? process.env?.PLATFORM_ROOT_DOMAIN : undefined) ||
        "highline.ro",
      platformAdminSubdomain: typeof process !== "undefined" ? process.env?.PLATFORM_ADMIN_SUBDOMAIN || "admin" : "admin",
      platformPublicUrl: typeof process !== "undefined" ? process.env?.PLATFORM_PUBLIC_URL : undefined,
    };
  }

  return {
    isProduction,
    isDevelopment: !isProduction,
    appUrl: process.env.APP_URL || "http://localhost:3000",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    googleMapsKey: process.env.GOOGLE_MAPS_PLATFORM_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "",
    firebaseVapidKey: process.env.VITE_FIREBASE_VAPID_KEY,
    platformRootDomain: process.env.PLATFORM_ROOT_DOMAIN || "highline.ro",
    platformAdminSubdomain: process.env.PLATFORM_ADMIN_SUBDOMAIN || "admin",
    platformPublicUrl: process.env.PLATFORM_PUBLIC_URL,
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    },
  };
}

export const envConfig = getEnvConfig();
