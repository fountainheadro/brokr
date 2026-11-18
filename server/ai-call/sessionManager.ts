import { GoogleGenAI, Type } from "@google/genai";
import { WebSocket } from "ws";

export type CallStatus = "idle" | "calling" | "connected" | "ended" | "failed";

export interface TranscriptItem {
  speaker: "assistant" | "user" | "system";
  text: string;
  timestamp: string;
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
  tenantId?: string;
  status: CallStatus;
  transcript: TranscriptItem[];
  notes: LiveNotes;
  frontendConnections: Set<WebSocket>;
  debounceTimeout?: NodeJS.Timeout;
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
 * Creates or gets an active call session
 */
export function createSession(
  callSid: string,
  phoneNumber: string,
  prompt: string,
  ownerUid?: string,
  tenantId?: string
): CallSession {
  const session: CallSession = {
    callSid,
    phoneNumber,
    prompt,
    ownerUid,
    tenantId,
    status: "calling",
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
  return session;
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
 * Appends a line to the conversation transcript and triggers debounced Gemini notes extraction
 */
export function appendTranscript(session: CallSession, speaker: "assistant" | "user" | "system", text: string) {
  if (!text || !text.trim()) return;

  const item: TranscriptItem = {
    speaker,
    text: text.trim(),
    timestamp: new Date().toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  };

  session.transcript.push(item);
  console.log(`[CallSession ${session.callSid}] [${speaker.toUpperCase()}]: ${text}`);

  // Broadcast transcript update to the UI in real-time
  broadcastToFrontend(session, {
    type: "transcript",
    item
  });

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
    const notesJson: LiveNotes = JSON.parse(textOutput);

    // Update ongoing session notes
    session.notes = notesJson;

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
