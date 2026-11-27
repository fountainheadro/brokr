import { GoogleGenAI, Type } from "@google/genai";
import { WebSocket } from "ws";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { DailyQuotaTracker } from "../monitoring/svc_daily-quota-tracker";
import { TelemetryCollectorService } from "../../src/core/telemetry/svc_telemetry-collector";

export type CallStatus = "idle" | "calling" | "connected" | "ended" | "failed";

export const COL_CALL_SESSIONS = "call_sessions";
export const COL_CALL_SESSION_EVENTS = "call_session_events";

export interface TranscriptItem {
  seq: number;
  speaker: "assistant" | "user" | "system";
  text: string;
  timestamp: string;
  createdAt?: string;
}

export interface LiveNotes {
  live_summary: string;
  important_points: string[];
  contact_details: {
    names?: string[];
    company_names?: string[];
    emails?: string[];
    phones?: string[];
  };
  sentiment: string;
  follow_up_actions: string[];
}

export interface CallSession {
  callSid: string;
  phoneNumber: string;
  prompt: string;
  ownerUid?: string;
  tenantId: string;
  status: CallStatus;
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
  transcript: TranscriptItem[];
  notes: LiveNotes;
  frontendConnections: Set<WebSocket>;
  debounceTimeout?: NodeJS.Timeout;
}

export interface PersistedCallSessionMeta {
  callSid: string;
  phoneNumber: string;
  prompt: string;
  ownerUid?: string | null;
  tenantId: string;
  status: CallStatus;
  lastSeq: number;
  notes: LiveNotes;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedCallSessionEvent extends TranscriptItem {
  callSid: string;
  tenantId: string;
  seqPadded: string;
}

function sanitizeId(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 120);
}

function padSeq(seq: number): string {
  return String(Math.max(0, Math.floor(seq))).padStart(6, "0");
}

function resolveTenantId(tenantId?: string): string {
  const cleaned = sanitizeId(tenantId || "ten_brokr_default");
  return cleaned || "ten_brokr_default";
}

function persistSessionMetadata(session: CallSession): void {
  const safeCallSid = sanitizeId(session.callSid);
  const safeTenantId = resolveTenantId(session.tenantId);
  const meta: PersistedCallSessionMeta = {
    callSid: session.callSid,
    phoneNumber: session.phoneNumber,
    prompt: session.prompt,
    ownerUid: session.ownerUid ?? null,
    tenantId: safeTenantId,
    status: session.status,
    lastSeq: session.nextSeq,
    notes: session.notes,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };

  PersistentStoreService.set(COL_CALL_SESSIONS, `${safeTenantId}::${safeCallSid}`, meta);

  if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
    const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
    const docName = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenantId}/call_sessions/${safeCallSid}`;
    void PersistentStoreService.remoteCommitWrites(
      [
        {
          update: {
            name: docName,
            fields: PersistentStoreService.encodeDocumentFields(meta),
          },
        },
      ],
      "call_session_upsert"
    ).catch(() => {});
  }
}

function persistTranscriptEvent(session: CallSession, item: TranscriptItem): void {
  const safeCallSid = sanitizeId(session.callSid);
  const safeTenantId = resolveTenantId(session.tenantId);
  const seqPadded = padSeq(item.seq);
  const record: PersistedCallSessionEvent = {
    ...item,
    callSid: session.callSid,
    tenantId: safeTenantId,
    seqPadded,
  };

  PersistentStoreService.set(
    COL_CALL_SESSION_EVENTS,
    `${safeTenantId}::${safeCallSid}::${seqPadded}`,
    record
  );

  if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
    const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
    const docName = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenantId}/call_sessions/${safeCallSid}/events/${seqPadded}`;
    void PersistentStoreService.remoteCommitWrites(
      [
        {
          update: {
            name: docName,
            fields: PersistentStoreService.encodeDocumentFields(record),
          },
        },
      ],
      "call_session_event_append"
    ).catch(() => {});
  }
}

// In-memory sessions index
export const activeSessions = new Map<string, CallSession>();

// Initialize Gemini client on the server side
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ Warning: GEMINI_API_KEY is missing from environment. AI Call functionality will be limited.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "dummy-key",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      }
    }
  });
};

const ai = getGeminiClient();

/**
 * Creates or gets an active call session and durably persists its metadata.
 */
export function createSession(
  callSid: string,
  phoneNumber: string,
  prompt: string,
  ownerUid?: string,
  tenantId?: string
): CallSession {
  const nowIso = new Date().toISOString();
  const safeTenantId = resolveTenantId(tenantId);
  const session: CallSession = {
    callSid,
    phoneNumber,
    prompt,
    ownerUid,
    tenantId: safeTenantId,
    status: "calling",
    nextSeq: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    transcript: [],
    notes: {
      live_summary: "Apel inițiat. Se așteaptă răspunsul...",
      important_points: [],
      contact_details: {},
      sentiment: "Neutră",
      follow_up_actions: []
    },
    frontendConnections: new Set()
  };
  activeSessions.set(callSid, session);
  persistSessionMetadata(session);
  return session;
}

export function updateSessionStatus(session: CallSession, status: CallStatus): void {
  session.status = status;
  session.updatedAt = new Date().toISOString();
  persistSessionMetadata(session);
}

/**
 * Loads a call session + monotonically ordered transcript events from durable storage
 * when not present in local RAM (e.g. after a Cloud Run instance restart or failover).
 */
export async function loadPersistedCallSession(
  callSid: string,
  tenantId?: string
): Promise<CallSession | null> {
  const inMemory = activeSessions.get(callSid);
  if (inMemory) return inMemory;

  const safeCallSid = sanitizeId(callSid);
  const allMetas = PersistentStoreService.getAll<PersistedCallSessionMeta>(COL_CALL_SESSIONS);
  let meta: PersistedCallSessionMeta | null = null;

  if (tenantId) {
    const key = `${resolveTenantId(tenantId)}::${safeCallSid}`;
    meta = allMetas[key] || null;
  } else {
    meta =
      Object.values(allMetas).find(
        (m) => m.callSid === callSid || sanitizeId(m.callSid) === safeCallSid
      ) || null;
  }

  if (!meta && tenantId && process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
    const safeTenant = resolveTenantId(tenantId);
    meta = await PersistentStoreService.remoteGetAtPath<PersistedCallSessionMeta>(
      `tenants/${safeTenant}/call_sessions/${safeCallSid}`
    );
  }

  if (!meta) return null;

  const prefix = `${resolveTenantId(meta.tenantId)}::${safeCallSid}::`;
  const allEvents = PersistentStoreService.getAll<PersistedCallSessionEvent>(COL_CALL_SESSION_EVENTS);
  const orderedEvents = Object.entries(allEvents)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, evt]) => evt)
    .sort((a, b) => a.seq - b.seq)
    .map<TranscriptItem>((evt) => ({
      seq: evt.seq,
      speaker: evt.speaker,
      text: evt.text,
      timestamp: evt.timestamp,
      createdAt: evt.createdAt,
    }));

  const maxSeq = orderedEvents.reduce((acc, item) => Math.max(acc, item.seq), meta.lastSeq || 0);

  return {
    callSid: meta.callSid,
    phoneNumber: meta.phoneNumber,
    prompt: meta.prompt,
    ownerUid: meta.ownerUid || undefined,
    tenantId: meta.tenantId,
    status: meta.status,
    nextSeq: maxSeq,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    transcript: orderedEvents,
    notes: meta.notes,
    frontendConnections: new Set(),
  };
}

/**
 * Broadcasts a message to all frontend clients subscribed to this call session
 */
export function broadcastToFrontend(session: CallSession, message: any) {
  const payload = JSON.stringify(message);
  session.frontendConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

/**
 * Appends a line to the conversation transcript with a monotonic sequence number,
 * persists it durably, and triggers debounced Gemini notes extraction.
 */
export function appendTranscript(session: CallSession, speaker: "assistant" | "user" | "system", text: string) {
  if (!text || !text.trim()) return;

  session.nextSeq = (session.nextSeq || 0) + 1;
  const nowIso = new Date().toISOString();
  const item: TranscriptItem = {
    seq: session.nextSeq,
    speaker,
    text: text.trim(),
    timestamp: new Date().toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    createdAt: nowIso,
  };

  session.transcript.push(item);
  session.updatedAt = nowIso;
  persistTranscriptEvent(session, item);
  persistSessionMetadata(session);
  console.log(`[CallSession ${session.callSid}] [#${item.seq} ${speaker.toUpperCase()}]: ${text}`);

  // Broadcast transcript update to the UI in real-time
  broadcastToFrontend(session, {
    type: "transcript",
    item
  });

  // Skip external Gemini notes extraction during unit tests
  if (process.env.NODE_ENV === "test") {
    return;
  }

  // Debounce Gemini notes extraction by 3 seconds so we don't spam requests during active speaking chunks
  if (session.debounceTimeout) {
    clearTimeout(session.debounceTimeout);
  }

  session.debounceTimeout = setTimeout(() => {
    triggerNotesExtraction(session);
  }, 3000);
}

/**
 * Calls Gemini 4 Hydrogen to extract structured JSON notes from the ongoing conversation transcript
 */
async function triggerNotesExtraction(session: CallSession) {
  if (session.transcript.length === 0) return;

  try {
    const transcriptText = session.transcript
      .map((t) => `[${t.speaker === "assistant" ? "Asistent AI" : t.speaker === "user" ? "Client" : "Sistem"}]: ${t.text}`)
      .join("\n");

    console.log(`[CallSession ${session.callSid}] Extracting structured notes from transcript...`);

    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analizează transcrierea de mai jos a convorbirii telefonice în limba română dintre un asistent imobiliar inteligent AI (lucrând pentru agenția brokr) și un client/proprietar.
Extrage informațiile importante și actualizează structura JSON conform schemei precizate.

CONVERSAȚIE:
${transcriptText}

MANDAT / SCOP APEL DETECTAT:
${session.prompt}

Cerințe importante:
- Rezumatul live_summary trebuie să fie redactat într-o singură propoziție scurtă, clară și profesională în limba română.
- Important_points: o listă cu puncte cheie discutate (max 5).
- Sentiment: detectează starea de spirit (ex. "Pozitivă", "Neutră", "Frustrată/Obiecții", "Foarte receptivă").
- Contact_details: extrage nume de persoane, companii, emailuri și telefoane menționate direct în convorbire.
- Follow_up_actions: sarcini de urmat (ex. "Trimis ofertă pe WhatsApp", "Programat vizionare vineri la ora 14").`
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            live_summary: {
              type: Type.STRING,
              description: "Scurt rezumat la minut al discuției curente."
            },
            important_points: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Listă cu aspectele principale agreatate sau menționate."
            },
            contact_details: {
              type: Type.OBJECT,
              properties: {
                names: { type: Type.ARRAY, items: { type: Type.STRING } },
                company_names: { type: Type.ARRAY, items: { type: Type.STRING } },
                emails: { type: Type.ARRAY, items: { type: Type.STRING } },
                phones: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            },
            sentiment: {
              type: Type.STRING,
              description: "Sentimentul de ansamblu al clientului."
            },
            follow_up_actions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Acțiuni concrete de follow-up."
            }
          },
          required: ["live_summary", "important_points", "contact_details", "sentiment", "follow_up_actions"]
        }
      }
    });

    const textOutput = response.text?.trim() || "{}";
    DailyQuotaTracker.recordGeminiResponse({
      model: "gemini-4-hydrogen",
      response,
      fallbackPromptChars: transcriptText.length + (session.prompt?.length || 0),
      fallbackOutputChars: textOutput.length,
    });
    TelemetryCollectorService.recordGeminiResponseForTenant({
      tenantId: session.tenantId || "ten_brokr_default",
      model: "gemini-4-hydrogen",
      response,
      fallbackPromptChars: transcriptText.length + (session.prompt?.length || 0),
      fallbackOutputChars: textOutput.length,
    });
    const notesJson: LiveNotes = JSON.parse(textOutput);

    // Update ongoing session notes and persist durably
    session.notes = notesJson;
    session.updatedAt = new Date().toISOString();
    persistSessionMetadata(session);

    // Broadcast updated structured notes to frontend
    broadcastToFrontend(session, {
      type: "live_notes",
      notes: notesJson
    });

    console.log(`[CallSession ${session.callSid}] Notes successfully updated and broadcasted.`);
  } catch (err) {
    console.error(`Error in notes extraction for session ${session.callSid}:`, err);
  }
}
