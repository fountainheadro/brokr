/**
 * Phase 0: Automated Architecture, Payload, Fanout, Security & Latency Baseline Measurement Script
 *
 * Read-only audit against the live BROKR codebase and local dev server (if running).
 * Produces objective, reproducible metrics used to establish the Phase 0 Baseline Report
 * and validate measurable improvements after each subsequent phase (Phases 1–10).
 *
 * Usage:
 *   npm run baseline:phase0
 *   npm run baseline:phase0 -- --json
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUTPUT_JSON = process.argv.includes("--json");

interface CodeMatch {
  file: string;
  line: number;
  snippet: string;
}

function walkFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function findMatches(files: string[], regex: RegExp): CodeMatch[] {
  const matches: CodeMatch[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((text, idx) => {
      if (regex.test(text)) {
        matches.push({
          file: rel,
          line: idx + 1,
          snippet: text.trim().slice(0, 140),
        });
      }
    });
  }
  return matches;
}

function buildRealisticFullLeadDocument(imageCount: number) {
  const images = Array.from({ length: imageCount }, (_, i) => ({
    url: `https://ireland.apollo.olxcdn.com/v1/files/brokr-sample-photo-${String(i + 1).padStart(2, "0")}-RO/image;s=1920x1080`,
    category: i < 4 ? "Living" : i < 8 ? "Dormitor" : i < 12 ? "Bucătărie" : i < 15 ? "Baie" : "Alte Spații",
    selected: true,
    order: i + 1,
  }));

  const descriptionText = [
    "📌 ID P17246",
    "🏡 Apartament 3 camere 78 mp | Timpuri Noi | Metrou 5 min | Balcon 10 mp | Centrală proprie | Parcare inclusă",
    "",
    "78 mp utili, balcon generos de 10 mp, loc de parcare inclus și disponibilitate imediată.",
    "Apartament spațios, complet mobilat și utilat modern, situat în zona Timpuri Noi, la aproximativ 5 minute de mers pe jos până la stația de metrou și zonele de birouri centrale.",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "⭐ AVANTAJE PRINCIPALE",
    "",
    "-decomandat",
    "-suprafață utilă generoasă de 78 mp",
    "-balcon 10 mp cu vedere deschisă",
    "-loc de parcare subteran inclus",
    "-mutare imediată",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "🛋️ DOTĂRI",
    "",
    "-centrală proprie pe gaz",
    "-aer condiționat inverter în fiecare cameră",
    "-mașină de spălat rufe și mașină de spălat vase",
    "-frigider combinat, plită pe gaz, cuptor electric și hotă",
    "-mobilier modern realizat pe comandă cu multiple spații de depozitare",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "📍 LOCAȚIE",
    "",
    "Acces rapid către:",
    "-metrou Timpuri Noi",
    "-universități și centre de birouri",
    "-parcul Tineretului și centre comerciale",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "💰 ÎNCHIRIERE",
    "",
    "750 € / lună",
    "1 lună garanție",
    "Comision 50% + TVA",
    "Disponibil imediat",
  ].join("\n");

  return {
    id: "lead_sample_001",
    tenantId: "agency_pilot_001",
    propertyId: "P17246",
    url: "https://www.olx.ro/d/oferta/apartament-3-camere-timpuri-noi-metrou-balcon-parcare-ID9xYz1.html",
    title: "Apartament 3 camere 78 mp | Timpuri Noi | Metrou 5 min | Balcon 10 mp | Centrală proprie | Parcare inclusă",
    zone: "Timpuri Noi",
    price: "750 €",
    phone: "0722123456",
    author: "Popescu Andrei",
    transactionType: "Inchirieri",
    categoria: "Apartamente",
    status: "Noua",
    entityKind: "property",
    leadType: "Proprietar",
    agent: "agent_uid_001",
    mobilare: "Complet",
    parcare: "Subteran inclus",
    sursaIncalzire: "Centrala proprie",
    modIncalzire: "Calorifere",
    notes: "Proprietar flexibil pentru vizionări după ora 17:00. Acceptă familii sau cupluri fără animale de companie.",
    images: images.map((img) => img.url),
    extractedData: {
      markdownMarketing: descriptionText,
      categorizedImages: {
        Living: images.filter((i) => i.category === "Living").map((i) => i.url),
        Dormitor: images.filter((i) => i.category === "Dormitor").map((i) => i.url),
        "Bucătărie": images.filter((i) => i.category === "Bucătărie").map((i) => i.url),
        Baie: images.filter((i) => i.category === "Baie").map((i) => i.url),
        "Alte Spații": images.filter((i) => i.category === "Alte Spații").map((i) => i.url),
      },
      crmData: {
        general: {
          tipTranzactie: "Inchiriere",
          categorie: "Apartamente",
          zona: "Timpuri Noi",
          judet: "Bucuresti",
          localitate: "Sector 3",
          nrCamere: "3",
          compartimentare: "Decomandat",
          etaj: "4",
          nrEtaje: "8",
          anConstructie: "2021",
          nrBai: "2",
          nrBalcoane: "1",
        },
        caracteristici: {
          suprafete: {
            suprafataUtila: "78",
            suprafataConstruita: "93.6",
            suprafataUtilaTotala: "88",
            balcoane: "10",
            terase: "",
          },
          alteDetalii: {
            stadiuConstructie: "Finalizata",
            tipImobil: "Bloc",
            structuraRezistenta: "Beton",
            confort: "1",
          },
        },
        utilitati: {
          generale: ["Curent", "Apa", "Canalizare", "Gaz"],
          sistemIncalzire: ["Centrala proprie", "Calorifere"],
          climatizare: ["Aer conditionat"],
        },
        finisaje: {
          pereti: ["Vopsea lavabila", "Faianta"],
          podele: ["Parchet", "Gresie"],
          usaIntrare: ["Metal"],
          usiInterior: ["Lemn"],
          ferestreCuGeamTermopan: ["PVC"],
          izolatieTermica: ["Exterior"],
        },
        dotari: {
          mobilat: "Complet",
          bucatarie: ["Mobilata", "Utilata"],
          contorizare: ["Apometre", "Contor gaz", "Contor curent electric"],
          electrocasnice: ["Masina de spalat rufe", "Masina de spalat vase", "Frigider", "Plita", "Cuptor", "Hota", "TV"],
          priveliste: ["Spre oras"],
          alteSpatiiUtile: ["Boxa la subsol", "Loc parcare"],
        },
        pret: {
          valoare: "750",
          moneda: "EUR",
          detalii: {
            avans: "750",
            garantie: "750",
            comision: "50% + TVA",
          },
        },
        descriere: {
          titlu: "Apartament 3 camere 78 mp | Timpuri Noi | Metrou 5 min | Balcon 10 mp | Centrală proprie | Parcare inclusă",
          continut: descriptionText,
        },
      },
    },
    createdAt: "2026-11-20T10:15:00.000Z",
    updatedAt: "2026-11-22T14:30:00.000Z",
  };
}

function buildSlimLeadSummary(fullDoc: ReturnType<typeof buildRealisticFullLeadDocument>) {
  return {
    id: fullDoc.id,
    tenantId: fullDoc.tenantId,
    propertyId: fullDoc.propertyId,
    entityKind: fullDoc.entityKind,
    status: fullDoc.status,
    title: fullDoc.title,
    zone: fullDoc.zone,
    price: fullDoc.price,
    transactionType: fullDoc.transactionType,
    categoria: fullDoc.categoria,
    rooms: 3,
    usableAreaSqm: 78,
    leadType: fullDoc.leadType,
    agentUid: fullDoc.agent,
    coverImageUrl: fullDoc.images[0] || "",
    imageCount: fullDoc.images.length,
    phoneLast4: fullDoc.phone.slice(-4),
    sourceDomain: "olx.ro",
    createdAt: fullDoc.createdAt,
    updatedAt: fullDoc.updatedAt,
    projectionVersion: 1,
  };
}

function auditServerRoutes() {
  const serverPath = path.join(ROOT, "server.ts");
  const lines = fs.readFileSync(serverPath, "utf8").split("\n");
  const routes: Array<{
    line: number;
    method: string;
    path: string;
    hasAuth: boolean;
    hasTenantContext: boolean;
    hasPlatformAuth: boolean;
    hasRateLimiter: boolean;
  }> = [];

  const routeRegex = /app\.(get|post|put|patch|delete|use)\(\s*["'`]([^"'`]+)["'`]/;
  for (let i = 0; i < lines.length; i++) {
    const m = routeRegex.exec(lines[i]);
    if (!m) continue;
    const method = m[1].toUpperCase();
    const routePath = m[2];
    if (!routePath.startsWith("/api")) continue;
    const windowText = lines.slice(i, Math.min(i + 8, lines.length)).join(" ");
    routes.push({
      line: i + 1,
      method,
      path: routePath,
      hasAuth: windowText.includes("mwAuthentication"),
      hasTenantContext: windowText.includes("requireTenantContext"),
      hasPlatformAuth: windowText.includes("mwPlatformAuthorization"),
      hasRateLimiter: windowText.includes("mwRateLimiter") || windowText.includes("RateLimiter"),
    });
  }
  return routes;
}

function auditFirestoreRulesLookups() {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  const extract = (name: string) => {
    const start = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(rules);
    if (!start) return "";
    let depth = 0;
    let i = start.index + start[0].length - 1;
    const s = i;
    for (; i < rules.length; i++) {
      if (rules[i] === "{") depth++;
      else if (rules[i] === "}") {
        depth--;
        if (depth === 0) return rules.slice(s, i + 1);
      }
    }
    return "";
  };
  const ops = (fn: string) => {
    const body = extract(fn);
    return {
      exists: (body.match(/\bexists\(/g) || []).length,
      get: (body.match(/\bget\(/g) || []).length,
    };
  };
  const isTenantMember = ops("isTenantMember");
  const isTenantActive = ops("isTenantActive");
  const getTenantMembership = ops("getTenantMembership");
  const isSelfBinding = ops("isSelfBindingFromActiveInvite");
  return {
    isTenantMember,
    isTenantActive,
    getTenantMembership,
    isActiveTenantMemberTotalCalls:
      isTenantMember.exists +
      isTenantMember.get +
      isTenantActive.exists +
      isTenantActive.get +
      getTenantMembership.exists +
      getTenantMembership.get,
    isActiveTenantMemberDistinctDocs: 2,
    isSelfBindingFromActiveInvite: isSelfBinding,
  };
}

async function probeLocalApiLatency() {
  const url = "http://127.0.0.1:3000/api/health";
  const samplesMs: number[] = [];
  let reachable = true;

  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    try {
      const res = await fetch(url);
      if (!res.ok) {
        reachable = false;
        break;
      }
      await res.text();
      samplesMs.push(Number((performance.now() - start).toFixed(2)));
    } catch {
      reachable = false;
      break;
    }
  }

  if (!reachable || samplesMs.length === 0) {
    return { reachable: false, samples: 0, p50Ms: null, p95Ms: null, maxMs: null };
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  return {
    reachable: true,
    samples: sorted.length,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

async function main() {
  const srcFiles = walkFiles(path.join(ROOT, "src"), [".ts", ".tsx"]);
  const serverFiles = [
    path.join(ROOT, "server.ts"),
    ...walkFiles(path.join(ROOT, "server"), [".ts"]),
  ];

  // 1. Client Subscription & Interval Audit
  const subscribeMatches = findMatches(srcFiles, /\bsubscribeTo[A-Za-z0-9_]+\(/);
  const directOnSnapshotMatches = findMatches(srcFiles, /\bonSnapshot\(/);
  const clientSetIntervalMatches = findMatches(srcFiles, /\bsetInterval\(/);
  const serverSetIntervalMatches = findMatches(serverFiles, /\bsetInterval\(/);

  const subscriptionsByFile: Record<string, number> = {};
  for (const m of subscribeMatches) {
    subscriptionsByFile[m.file] = (subscriptionsByFile[m.file] || 0) + 1;
  }

  // 2. Payload Size & Firestore Enterprise 4 KiB Read-Unit Benchmark
  const payloadBenchmarks = [10, 25, 50].map((imgCount) => {
    const fullDoc = buildRealisticFullLeadDocument(imgCount);
    const slimDoc = buildSlimLeadSummary(fullDoc);
    const fullBytes = Buffer.byteLength(JSON.stringify(fullDoc), "utf8");
    const slimBytes = Buffer.byteLength(JSON.stringify(slimDoc), "utf8");
    const fullReadUnitsEnterprise = Math.ceil(fullBytes / 4096);
    const slimReadUnitsEnterprise = Math.ceil(slimBytes / 4096);
    const list50FullKB = Number(((fullBytes * 50) / 1024).toFixed(1));
    const list50SlimKB = Number(((slimBytes * 50) / 1024).toFixed(1));
    const reductionPct = Number((((fullBytes - slimBytes) / fullBytes) * 100).toFixed(1));

    return {
      imageCount: imgCount,
      fullDocBytes: fullBytes,
      slimDocBytes: slimBytes,
      fullReadUnitsEnterprise,
      slimReadUnitsEnterprise,
      list50FullKB,
      list50SlimKB,
      reductionPct,
    };
  });

  // 3. SDK & Runtime Configuration Audit
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const firebaseClientSrc = fs.readFileSync(path.join(ROOT, "src/lib/firebase.ts"), "utf8");
  const serverTsSrc = fs.readFileSync(path.join(ROOT, "server.ts"), "utf8");
  const firebaseAppletConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, "firebase-applet-config.json"), "utf8")
  );

  const trustProxyMatch = /app\.set\(\s*["']trust proxy["']\s*,\s*([^)]+)\)/.exec(serverTsSrc);
  const trustProxyValue = trustProxyMatch ? trustProxyMatch[1].trim() : null;

  const sdkAudit = {
    projectId: firebaseAppletConfig.projectId,
    firestoreDatabaseId: firebaseAppletConfig.firestoreDatabaseId,
    storageBucket: firebaseAppletConfig.storageBucket,
    firebaseAdminInstalled: Boolean(pkg.dependencies?.["firebase-admin"]),
    clientUsesLongPolling: firebaseClientSrc.includes("experimentalForceLongPolling: true"),
    clientUsesIndexedDbCache:
      firebaseClientSrc.includes("persistentLocalCache") ||
      firebaseClientSrc.includes("persistentMultipleTabManager"),
    serverTrustProxy: trustProxyValue,
    serverGlobalJsonLimit50mb: /express\.json\(\s*\{[\s\S]{0,200}limit:\s*["']50mb["']/.test(serverTsSrc),
    serverLocalUploadsDirCreated: serverTsSrc.includes('path.resolve("./public/uploads")'),
  };

  // 4. Backend Route Security Coverage
  const routes = auditServerRoutes();
  const routesAuthWithoutTenant = routes.filter((r) => r.hasAuth && !r.hasTenantContext && !r.hasPlatformAuth);

  // 5. Security Rules Lookup Audit
  const rulesLookupAudit = auditFirestoreRulesLookups();

  // 6. Live Local API Health Probe
  const healthProbe = await probeLocalApiLatency();

  const report = {
    generatedAt: new Date().toISOString(),
    sdkAudit,
    clientFanout: {
      totalSubscribeCallsInSrc: subscribeMatches.length,
      directOnSnapshotCallsInSrc: directOnSnapshotMatches.length,
      subscriptionsByFile,
      clientSetIntervalCount: clientSetIntervalMatches.length,
      clientSetIntervals: clientSetIntervalMatches,
      serverSetIntervalCount: serverSetIntervalMatches.length,
      serverSetIntervals: serverSetIntervalMatches,
    },
    payloadBenchmarks,
    rulesLookupAudit,
    backendRoutes: {
      totalApiRoutesInServerTs: routes.length,
      routesWithAuthOnlyMissingTenantContext: routesAuthWithoutTenant.map((r) => ({
        line: r.line,
        method: r.method,
        path: r.path,
      })),
    },
    localApiHealthProbe: healthProbe,
  };

  if (OUTPUT_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("==================================================================");
  console.log("📊 BROKR PHASE 0 — AUTOMATED ARCHITECTURE & BASELINE MEASUREMENT");
  console.log("==================================================================");
  console.log(`Timestamp:           ${report.generatedAt}`);
  console.log(`Firebase Project:    ${sdkAudit.projectId}`);
  console.log(`Firestore DB ID:     ${sdkAudit.firestoreDatabaseId}`);
  console.log(`Storage Bucket:      ${sdkAudit.storageBucket}`);
  console.log(`firebase-admin SDK:  ${sdkAudit.firebaseAdminInstalled ? "INSTALLED" : "NOT INSTALLED (REST v1 + RS256 JWKS)"}`);
  console.log(`IndexedDB Cache:     ${sdkAudit.clientUsesIndexedDbCache ? "ENABLED" : "DISABLED (memory-only + experimentalForceLongPolling)"}`);
  console.log(`trust proxy:         ${sdkAudit.serverTrustProxy ?? "MISSING"}${sdkAudit.serverTrustProxy === "true" ? " (permissive — tighten to 1 in Phase 3)" : ""}`);
  console.log(`Global 50MB JSON:    ${sdkAudit.serverGlobalJsonLimit50mb ? "YES (global 50mb — tighten in Phase 3)" : "NO"}`);
  console.log(`Local ./uploads dir: ${sdkAudit.serverLocalUploadsDirCreated ? "YES (ephemeral disk — migrate to GCS in Phase 4)" : "NO"}`);

  console.log("\n--- 1. Client Subscription & Background Polling Fanout ---");
  console.log(`Total subscribeTo* calls in src/:  ${report.clientFanout.totalSubscribeCallsInSrc}`);
  console.log(`Direct onSnapshot calls in src/:   ${report.clientFanout.directOnSnapshotCallsInSrc}`);
  Object.entries(subscriptionsByFile)
    .sort((a, b) => b[1] - a[1])
    .forEach(([file, count]) => console.log(`  • ${file}: ${count}`));
  console.log(`Client setInterval() timers:       ${report.clientFanout.clientSetIntervalCount}`);
  clientSetIntervalMatches.forEach((m) => console.log(`  • ${m.file}:${m.line} -> ${m.snippet}`));
  console.log(`Server setInterval() timers:       ${report.clientFanout.serverSetIntervalCount}`);
  serverSetIntervalMatches.forEach((m) => console.log(`  • ${m.file}:${m.line} -> ${m.snippet}`));

  console.log("\n--- 2. Document Payload Size & Firestore Enterprise 4 KiB Read Units ---");
  for (const b of payloadBenchmarks) {
    console.log(
      `  • ${b.imageCount} images: Full=${b.fullDocBytes} B (${b.fullReadUnitsEnterprise} Enterprise RU) | ` +
        `Slim=${b.slimDocBytes} B (${b.slimReadUnitsEnterprise} RU) | ` +
        `50-item list: ${b.list50FullKB} KB -> ${b.list50SlimKB} KB (-${b.reductionPct}%)`
    );
  }

  console.log("\n--- 3. Firestore Rules Lookup-Cost Baseline ---");
  console.log(
    `  • isActiveTenantMember(): ${rulesLookupAudit.isActiveTenantMemberTotalCalls} lookup calls across ${rulesLookupAudit.isActiveTenantMemberDistinctDocs} distinct docs`
  );
  console.log(
    `    (isTenantMember: ${rulesLookupAudit.isTenantMember.exists} exists, ` +
      `isTenantActive: ${rulesLookupAudit.isTenantActive.exists} exists + ${rulesLookupAudit.isTenantActive.get} get, ` +
      `getTenantMembership: ${rulesLookupAudit.getTenantMembership.get} get)`
  );

  console.log("\n--- 4. Backend Expensive Routes Missing Tenant Context / Quota Guard ---");
  console.log(`Total /api routes in server.ts:    ${report.backendRoutes.totalApiRoutesInServerTs}`);
  console.log(`Routes with mwAuthentication only: ${routesAuthWithoutTenant.length}`);
  routesAuthWithoutTenant.forEach((r) => console.log(`  • [L${r.line}] ${r.method} ${r.path}`));

  console.log("\n--- 5. Local Dev Server Health Latency Probe (/api/health) ---");
  if (healthProbe.reachable) {
    console.log(
      `  • Samples: ${healthProbe.samples} | p50: ${healthProbe.p50Ms} ms | p95: ${healthProbe.p95Ms} ms | max: ${healthProbe.maxMs} ms`
    );
  } else {
    console.log("  • Local server on 127.0.0.1:3000 not reachable during probe.");
  }
}

main().catch((err) => {
  console.error("Phase 0 baseline measurement failed:", err);
  process.exit(1);
});
