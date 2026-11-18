import { Router } from "express";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "url";
import { IncomingMessage } from "http";
import { createSession, activeSessions, appendTranscript, broadcastToFrontend, CallStatus } from "./sessionManager";
import { ulawToPcm, pcmToUlaw, resample8To16, resample24To8 } from "./g711";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import axios from "axios";
import { mwAuthentication, authenticateTokenString } from "../middleware/mw_authentication";
import {
  mwTwilioSignature,
  verifyTwilioWsUpgrade,
  createTwilioStreamToken,
  verifyTwilioStreamToken,
} from "../middleware/mw_twilio-signature";
import { logger } from "../../src/core/logger/logger";

export const aiCallRouter = Router();

// Track Twilio stream connections
const twilioStreams = new Map<string, { ws: WebSocket; callSid: string }>();

// Simple logger helper for this module
const log = (msg: string) => console.log(`[AI-Call Module] ${msg}`);

/**
 * Endpoint to serve TwiML instructions when Twilio calls
 */
/**
 * Helper to dynamically determine the public, secure URL of this application
 * considering proxy setups, headers, referer and fallback options.
 */
const getPublicUrl = (req: any): string => {
  // 1. Try x-forwarded-host (standard header set by reverse proxies like Nginx/Cloud Run)
  let host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  
  // 2. If it resolves to localhost/127.0.0.1, check for referer to extract public hostname
  if ((host.includes("localhost") || host.includes("127.0.0.1")) && req.headers.referer) {
    try {
      const refererUrl = new URL(req.headers.referer);
      host = refererUrl.host;
    } catch (e) {
      // Ignore URL parsing failure
    }
  }

  // 3. Determine protocol (secure HTTPS is standard on Cloud Run, default to it if x-forwarded-proto, referer, or cloud env says so)
  const isHttps = 
    req.secure || 
    req.headers["x-forwarded-proto"] === "https" || 
    (req.headers.referer && req.headers.referer.startsWith("https:")) ||
    process.env.NODE_ENV === "production";
    
  const protocol = isHttps ? "https" : "http";

  return `${protocol}://${host}`;
};

const handleTwiml = (req: any, res: any) => {
  const prompt = (req.query.prompt || req.body?.prompt || "Discută politicos despre oportunitatea imobiliară.").toString();
  const callSidParam = (req.body?.CallSid || req.query?.CallSid || "").toString();
  const streamToken = callSidParam ? createTwilioStreamToken(callSidParam) : "";

  const publicUrl = getPublicUrl(req);
  const wssProtocol = publicUrl.startsWith("https") ? "wss" : "ws";
  
  // Extract host from publicUrl for stream
  let host = "localhost:3000";
  try {
    const urlObj = new URL(publicUrl);
    host = urlObj.host;
  } catch (e) {
    // Fallback
    host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  }
  
  const wsUrl = `${wssProtocol}://${host}/api/ai-call/stream`;

  log(`Serving TwiML for incoming call. WebSocket Stream URL target: ${wsUrl}`);

  res.setHeader("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="ro-RO" voice="Google.ro-RO-Standard-A">Conectare cu sistemul inteligent brokr. Te rog așteaptă.</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="prompt" value="${encodeURIComponent(prompt)}" />
      ${streamToken ? `<Parameter name="streamToken" value="${streamToken}" />` : ""}
    </Stream>
  </Connect>
</Response>`);
};

aiCallRouter.get("/twiml", mwTwilioSignature, handleTwiml);
aiCallRouter.post("/twiml", mwTwilioSignature, handleTwiml);

// Helper to safely format romanian and other numbers into Standard E.164 format
const formatE164 = (numStr: string): string => {
  let clean = numStr.trim().replace(/[\s\-\(\)]/g, "");
  if (clean.startsWith("00")) {
    clean = "+" + clean.slice(2);
  }
  if (clean.startsWith("0") && clean.length === 10) {
    return "+40" + clean.slice(1);
  }
  if (clean.startsWith("40") && clean.length === 11) {
    return "+" + clean;
  }
  if (clean.startsWith("7") && clean.length === 9) {
    return "+40" + clean;
  }
  if (!clean.startsWith("+")) {
    return "+" + clean;
  }
  return clean;
};

/**
 * Initiates an outbound trial/real Call
 */
aiCallRouter.post("/dial", mwAuthentication, async (req, res) => {
  const { phoneNumber, prompt } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Numărul de telefon este obligatoriu." });
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

  log(`Request to dial ${phoneNumber} with prompt: "${prompt}"`);

  // Fallback / Demonstration Mode if Twilio keys are not configured
  if (!twilioSid || !twilioToken || !twilioFrom) {
    const mockCallSid = `CA_mock_${crypto.randomBytes(12).toString("hex")}`;
    log(`⚠️ Twilio credentials missing in environmental variables. Starting SIMULATION session ${mockCallSid} for demo.`);
    
    // Create actual active session bound to caller UID
    const session = createSession(mockCallSid, phoneNumber, prompt, req.authUser?.uid);
    session.status = "calling";

    // Simulate real-time Romanian conversation for spectacular demonstration
    let step = 0;
    const interval = setInterval(() => {
      const active = activeSessions.get(mockCallSid);
      if (!active || active.status === "ended") {
        clearInterval(interval);
        return;
      }

      step++;
      if (step === 1) {
        active.status = "connected";
        broadcastToFrontend(active, { type: "status", status: "connected" });
        appendTranscript(active, "system", "Conexiune stabilită via VoIP Brokr.");
      } else if (step === 2) {
        appendTranscript(active, "user", "Alo? Bună ziua. Cine este la telefon?");
      } else if (step === 3) {
        appendTranscript(active, "assistant", "Bună ziua! Mă numesc Andrei și vă contactez din partea agenției imobiliare brokr.");
      } else if (step === 4) {
        appendTranscript(active, "user", "A, da! În legătură cu apartmentul de vânzare din Sectorul 3?");
      } else if (step === 5) {
        appendTranscript(active, "assistant", "Doresc să aflu dacă mai este valabil anunțul și dacă prețul de 89.000 de euro este ușor negociabil.");
      } else if (step === 6) {
        appendTranscript(active, "user", "Da, mai este valabil. Prețul este fix, dar putem discuta la fața locului.");
      } else if (step === 7) {
        appendTranscript(active, "assistant", "Perfect. Când ați avea timp liber pentru a programa o vizionare rapidă?");
      } else if (step === 8) {
        appendTranscript(active, "user", "Oricând după ora 16:00, în cursul săptămânii.");
      } else if (step === 9) {
        appendTranscript(active, "assistant", "Vă mulțumesc mult! Am notat detaliile și vă vom contacta rapid pentru confirmare.");
        active.status = "ended";
        broadcastToFrontend(active, { type: "status", status: "ended" });
        appendTranscript(active, "system", "Apel finalizat de către client.");
        clearInterval(interval);
      }
    }, 6000);

    return res.json({
      success: true,
      simulated: true,
      callSid: mockCallSid,
      message: "Mod SIMULARE activat (lipsă credențiale Twilio)."
    });
  }

  try {
    const formattedTo = formatE164(phoneNumber);
    const formattedFrom = formatE164(twilioFrom);

    const publicUrl = getPublicUrl(req);
    const twimlUrl = `${publicUrl}/api/ai-call/twiml?prompt=${encodeURIComponent(prompt)}`;

    log(`Dialing via Twilio REST API from: ${formattedFrom} to: ${formattedTo} using twiml url: ${twimlUrl}`);

    const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
    const params = new URLSearchParams();
    params.append("To", formattedTo);
    params.append("From", formattedFrom);
    params.append("Url", twimlUrl);

    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
      params,
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const callSid = response.data.sid;
    log(`Outbound call successfully initiated. CallSid: ${callSid}`);

    // Create persistent call session bound to caller UID
    createSession(callSid, formattedTo, prompt, req.authUser?.uid);

    return res.json({
      success: true,
      simulated: false,
      callSid,
      message: "Apelul Twilio a fost lansat cu succes."
    });
  } catch (error: any) {
    console.error("Twilio REST API Dial Error:", error.response?.data || error);
    
    let rawDetails = error.response?.data?.message || error.message || "";
    let friendlyExplanation = rawDetails;

    if (rawDetails.includes("is unverified") || rawDetails.includes("Trial accounts") || rawDetails.includes("21219")) {
      friendlyExplanation = "Numărul către care doriți să inițiați apelul nu este verificat în consola Twilio! Deoarece folosiți un cont gratuit Twilio Trial, compania vă impune să efectuați apeluri doar către numere proprii verificate în prealabil în consola de administrare Twilio (de exemplu, numărul dvs. personal).";
    } else if (rawDetails.includes("From is not a valid phone number") || rawDetails.includes("21212") || rawDetails.includes("21210")) {
      friendlyExplanation = "Numărul expeditor (From) setat în profil / mediu nu este un număr valid cumpărat sau înregistrat în contul dvs. Twilio. Vă rugăm să verificați numărul expeditor în setări.";
    }

    return res.status(500).json({
      error: "Eșec la conectarea cu Twilio API",
      details: friendlyExplanation
    });
  }
});

/**
 * Returns currently active call session or status
 */
aiCallRouter.get("/session/:callSid", mwAuthentication, (req, res) => {
  const session = activeSessions.get(req.params.callSid);
  if (!session) {
    return res.status(404).json({ error: "Sesiunea de apel nu a fost găsită." });
  }
  if (session.ownerUid && req.authUser?.uid && session.ownerUid !== req.authUser.uid) {
    return res.status(403).json({ error: "Acces interzis la sesiunea de apel a altui utilizator." });
  }
  return res.json({
    callSid: session.callSid,
    phoneNumber: session.phoneNumber,
    prompt: session.prompt,
    status: session.status,
    transcript: session.transcript,
    notes: session.notes
  });
});

/**
 * Setup WebSocket Server upgrading in Express app
 */
export function setupWebSocket(server: any) {
  const wssTwilio = new WebSocketServer({ noServer: true });
  const wssFrontend = new WebSocketServer({ noServer: true });

  // 1. Twilio Live Audio Media Stream WebSocket Handler
  wssTwilio.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
    log("Twilio Media Stream WebSocket Connected.");
    let callSid = "";
    let streamSid = "";
    let geminiSession: any = null;
    let initialPrompt = "Vorbește în română și asistă imobiliar clientul în mod politicos.";

    ws.on("message", async (message: string) => {
      try {
        const msg = JSON.parse(message);

        if (msg.event === "start") {
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          const providedStreamToken = msg.start?.customParameters?.streamToken;
          const strictTwilioMode =
            Boolean(process.env.TWILIO_AUTH_TOKEN?.trim()) || process.env.NODE_ENV === "production";

          if (strictTwilioMode && providedStreamToken && !verifyTwilioStreamToken(callSid, String(providedStreamToken))) {
            logger.recordMetric("twilio_signature_rejection");
            log(`Rejected Twilio stream start with invalid streamToken for CallSid=${callSid}`);
            ws.close(4003, "Invalid stream token");
            return;
          }

          log(`Media stream started: CallSid=${callSid}, StreamSid=${streamSid}`);
          
          // Hold stream reference to send responses back
          twilioStreams.set(streamSid, { ws, callSid });

          // Retrieve stored session prompt
          let session = activeSessions.get(callSid);
          if (!session) {
            session = createSession(callSid, "Necunoscut", initialPrompt);
          }
          session.status = "connected";
          initialPrompt = session.prompt;

          // Notify frontend that VoIP is connected and ready
          broadcastToFrontend(session, { type: "status", status: "connected" });
          appendTranscript(session, "system", "Conexiune vocală securizată realizată.");

          // Instantiate connection to Google Gemini Live API
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            log("❌ Error: Cannot establish Gemini Live connection because GEMINI_API_KEY is missing!");
            appendTranscript(session, "system", "Eroare: Lipsă cheie API Gemini.");
            return;
          }

          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                "User-Agent": "aistudio-build",
              },
            },
          });
          
          log("Connecting to Multimodal Gemini Live WebSocket API...");
          geminiSession = await ai.live.connect({
            model: "gemini-3.8-live",
            callbacks: {
              onmessage: (geminiMsg: LiveServerMessage) => {
                const serverContent = geminiMsg.serverContent as any;
                if (!serverContent) return;

                // Handle Model transcribed text output (AI speaks transcript)
                if (serverContent.modelTurn?.parts) {
                  for (const part of serverContent.modelTurn.parts) {
                    if (part.text) {
                      appendTranscript(session!, "assistant", part.text);
                    }
                    if (part.inlineData?.data) {
                      // We received 24kHz Mono 16-bit PCM. Let's downsample and convert to 8kHz mu-law PCMU for Twilio.
                      const base64PCM = part.inlineData.data;
                      const rawPCM = Buffer.from(base64PCM, "base64");
                      const pcmShorts = new Int16Array(rawPCM.buffer, rawPCM.byteOffset, rawPCM.byteLength / 2);
                      const pcm8k = resample24To8(pcmShorts);
                      const ulaw = pcmToUlaw(pcm8k);
                      const base64PCMU = Buffer.from(ulaw.buffer, ulaw.byteOffset, ulaw.byteLength).toString("base64");

                      // Forward Mu-law audio back to Twilio
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                          event: "media",
                          streamSid,
                          media: {
                            payload: base64PCMU
                          }
                        }));
                      }
                    }
                  }
                }

                // Handle User transcribed text output (Customer speaks transcript)
                if (serverContent.userTurn?.parts) {
                  for (const part of serverContent.userTurn.parts) {
                    if (part.text) {
                      appendTranscript(session!, "user", part.text);
                    }
                  }
                }

                // Handle user speaking interruption
                if (serverContent.interrupted) {
                  log(`User interrupted the model's speaking flow. Cleared audio queue.`);
                  ws.send(JSON.stringify({
                    event: "clear",
                    streamSid
                  }));
                }
              }
            },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
              },
              systemInstruction: `Sunteți Andrei, un agent imobiliar virtual extrem de politicos, cald și profesionist de la biroul brokr.
Scopul dumneavoastră este să stabiliți o relație călduroasă prin telefon cu proprietarul sau clientul, să discutați cu diacritice în română într-un limbaj simplu, aerisit, natural, să puneți întrebări deschise și să obțineți elementele solicitate.
Informații suplimentare pentru ghidarea conversației:
"${initialPrompt}"

Răspundeți întotdeauna pe un ton binevoitor, concis, prietenos și extrem de politicos. Pentru a stabili o legătură de încredere, asigurați-vă că nu vorbiți în paragrafe lungi, folosiți propoziții scurte și clare adaptate pentru conversație telefonică orală.`,
              inputAudioTranscription: {},
              outputAudioTranscription: {}
            }
          });

          log("Successfully connected to Gemini Live session bridge.");
        }

        if (msg.event === "media" && geminiSession) {
          // Received phone audio chunk in μ-law format from Twilio
          const base64Payload = msg.media.payload;
          const ulawBytes = Uint8Array.from(Buffer.from(base64Payload, "base64"));
          
          // Decode mu-law (8kHz PCMU) into 8kHz signed Linear PCM
          const pcm8k = ulawToPcm(ulawBytes);
          
          // Upsample from 8kHz to 16kHz PCM for Gemini Live consumption
          const pcm16k = resample8To16(pcm8k);
          const base64PCM16 = Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength).toString("base64");

          // Send to Gemini Multimodal Live websocket stream
          geminiSession.sendRealtimeInput({
            audio: {
              data: base64PCM16,
              mimeType: "audio/pcm;rate=16000"
            }
          });
        }

        if (msg.event === "stop") {
          log(`Twilio stream stopped for streamSid=${streamSid}`);
          cleanupStream();
        }
      } catch (err) {
        console.error("Twilio incoming socket message parsing error:", err);
      }
    });

    const cleanupStream = () => {
      if (streamSid) {
        twilioStreams.delete(streamSid);
      }
      if (callSid) {
        const session = activeSessions.get(callSid);
        if (session) {
          session.status = "ended";
          broadcastToFrontend(session, { type: "status", status: "ended" });
          appendTranscript(session, "system", "Convorbirea s-a încheiat.");
        }
      }
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (e) {}
        geminiSession = null;
      }
    };

    ws.on("close", () => {
      log(`Twilio WS stream closed.`);
      cleanupStream();
    });

    ws.on("error", (e) => {
      console.error("Twilio WS error:", e);
      cleanupStream();
    });
  });

  // 2. React Frontend App Stream WS Handler (authenticated via Firebase Bearer/frame token)
  wssFrontend.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    let currentCallSid = "";
    let authenticatedUid: string | null = null;
    let authTimeout: NodeJS.Timeout | null = setTimeout(() => {
      if (!authenticatedUid && ws.readyState === WebSocket.OPEN) {
        logger.recordMetric("auth_failure");
        ws.close(4001, "Authentication required");
      }
    }, 10000);

    // Support optional Authorization Bearer header on upgrade
    const upgradeAuth = request.headers.authorization;
    const upgradeBearer =
      typeof upgradeAuth === "string" && upgradeAuth.startsWith("Bearer ")
        ? upgradeAuth.substring(7).trim()
        : null;

    log("Frontend Web-App WebSocket Client connected (awaiting authentication).");

    ws.on("message", async (msgStr: string) => {
      try {
        const msg = JSON.parse(msgStr.toString());

        if (!authenticatedUid) {
          const candidateToken = (typeof msg.authToken === "string" ? msg.authToken : upgradeBearer) || "";
          try {
            const user = await authenticateTokenString(candidateToken);
            authenticatedUid = user.uid;
            if (authTimeout) {
              clearTimeout(authTimeout);
              authTimeout = null;
            }
          } catch {
            logger.recordMetric("auth_failure");
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "error", error: "Autentificare WebSocket eșuată." }));
              ws.close(4001, "Unauthorized");
            }
            return;
          }
        }

        if (msg.type === "subscribe" && msg.callSid) {
          const requestedCallSid = String(msg.callSid);
          const session = activeSessions.get(requestedCallSid);
          if (session && session.ownerUid && session.ownerUid !== authenticatedUid) {
            logger.recordMetric("authz_failure");
            ws.send(JSON.stringify({ type: "error", error: "Acces interzis la acest apel." }));
            ws.close(4003, "Forbidden");
            return;
          }

          currentCallSid = requestedCallSid;
          log(`Frontend client ${authenticatedUid} subscribed to CallSid: ${currentCallSid}`);

          if (session) {
            session.frontendConnections.add(ws);
            ws.send(JSON.stringify({
              type: "sync",
              status: session.status,
              transcript: session.transcript,
              notes: session.notes
            }));
          } else {
            ws.send(JSON.stringify({
              type: "sync",
              status: "idle",
              transcript: [],
              notes: {
                live_summary: "Sesiune inactivă",
                important_points: [],
                contact_details: {},
                sentiment: "",
                follow_up_actions: []
              }
            }));
          }
        }

        if (msg.type === "end_call" && currentCallSid) {
          const session = activeSessions.get(currentCallSid);
          if (session) {
            if (session.ownerUid && session.ownerUid !== authenticatedUid) {
              logger.recordMetric("authz_failure");
              ws.close(4003, "Forbidden");
              return;
            }
            log(`Frontend requested to terminate call session: ${currentCallSid}`);
            session.status = "ended";
            broadcastToFrontend(session, { type: "status", status: "ended" });
            appendTranscript(session, "system", "Apel întrerupt manual din panou.");
            
            const twilioSid = process.env.TWILIO_ACCOUNT_SID;
            const twilioToken = process.env.TWILIO_AUTH_TOKEN;
            if (twilioSid && twilioToken && !currentCallSid.startsWith("CA_mock")) {
              const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
              axios.post(
                `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${currentCallSid}.json`,
                new URLSearchParams({ Status: "completed" }),
                { headers: { "Authorization": `Basic ${auth}` } }
              ).catch((e) => console.error("Error terminating Twilio call via API:", e.message));
            }
          }
        }
      } catch (err) {
        console.error("Frontend socket message processing error:", err);
      }
    });

    ws.on("close", () => {
      if (authTimeout) {
        clearTimeout(authTimeout);
        authTimeout = null;
      }
      if (currentCallSid) {
        const session = activeSessions.get(currentCallSid);
        if (session) {
          session.frontendConnections.delete(ws);
        }
      }
    });
  });

  // Handle unified Node.js HTTP upgrade event routing
  server.on("upgrade", (request: IncomingMessage, socket: any, head: Buffer) => {
    const { pathname } = parseUrl(request.url || "");
    log(`HTTP UPGRADE REQUEST FOR PATH: ${pathname}`);

    if (pathname === "/api/ai-call/stream") {
      const twilioCheck = verifyTwilioWsUpgrade(request);
      if (!twilioCheck.ok) {
        logger.recordMetric("twilio_signature_rejection");
        log(`Rejected unauthenticated Twilio WebSocket upgrade: ${twilioCheck.reason}`);
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wssTwilio.handleUpgrade(request, socket, head, (ws) => {
        wssTwilio.emit("connection", ws, request);
      });
    } else if (pathname === "/api/ai-call/frontend") {
      wssFrontend.handleUpgrade(request, socket, head, (ws) => {
        wssFrontend.emit("connection", ws, request);
      });
    } else {
      // Allow other websocket connections to pass through safely if any
    }
  });
}
