import { getApiAuthHeaders } from "../../lib/apiAuth";

// AI Phone Call State Store (Pub-Sub pattern) for React updates
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

export interface CallStoreState {
  currentCallSid: string | null;
  status: CallStatus;
  transcript: TranscriptItem[];
  notes: LiveNotes;
  isModalOpen: boolean;
  activeTab: "call" | "notes";
}

const emptyNotes = (): LiveNotes => ({
  live_summary: "",
  important_points: [],
  contact_details: {},
  sentiment: "",
  follow_up_actions: []
});

let state: CallStoreState = {
  currentCallSid: null,
  status: "idle",
  transcript: [],
  notes: emptyNotes(),
  isModalOpen: false,
  activeTab: "call"
};

type Listener = (state: CallStoreState) => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l({ ...state }));
}

let socket: WebSocket | null = null;
let reconnectInterval: any = null;

// Connect to frontend updates workspace websocket
function connectWebSocket(callSid: string) {
  if (socket) {
    socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/ai-call/frontend`;
  
  console.log(`[AICallStore] Connecting to websocket server: ${wsUrl}`);
  socket = new WebSocket(wsUrl);

  socket.onopen = async () => {
    console.log(`[AICallStore] WS Connection opened. Subscribing to call: ${callSid}`);
    let authToken = "";
    try {
      const hdrs = await getApiAuthHeaders();
      if (hdrs.Authorization && hdrs.Authorization.startsWith("Bearer ")) {
        authToken = hdrs.Authorization.substring(7).trim();
      }
    } catch {
      // Ignored; backend closes unauthenticated sockets
    }
    socket?.send(JSON.stringify({ type: "subscribe", callSid, authToken }));
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`[AICallStore] WS Message:`, data);

      if (data.type === "sync") {
        state.status = data.status;
        state.transcript = data.transcript;
        state.notes = data.notes;
        emit();
      } else if (data.type === "status") {
        state.status = data.status;
        emit();
      } else if (data.type === "transcript") {
        // Avoid duplicate items
        const exists = state.transcript.some(
          (t) => t.text === data.item.text && t.speaker === data.item.speaker && t.timestamp === data.item.timestamp
        );
        if (!exists) {
          state.transcript = [...state.transcript, data.item];
          emit();
        }
      } else if (data.type === "live_notes") {
        state.notes = data.notes;
        emit();
      }
    } catch (e) {
      console.error("[AICallStore] Error parsing WebSocket message:", e);
    }
  };

  socket.onclose = () => {
    console.log("[AICallStore] WS Connection closed.");
    // Auto-reconnect if call is still active
    if (state.status === "calling" || state.status === "connected") {
      if (!reconnectInterval) {
        reconnectInterval = setInterval(() => {
          console.log("[AICallStore] Retrying WebSocket subscribe connection...");
          connectWebSocket(callSid);
        }, 3000);
      }
    }
  };

  socket.onerror = (e) => {
    console.error("[AICallStore] WS Socket Error:", e);
  };
}

export const AICallStore = {
  getState() {
    return state;
  },

  subscribe(listener: Listener) {
    listeners.add(listener);
    listener({ ...state });
    return () => {
      listeners.delete(listener);
    };
  },

  openModal(tab: "call" | "notes") {
    state.isModalOpen = true;
    state.activeTab = tab;
    emit();
  },

  closeModal() {
    state.isModalOpen = false;
    emit();
  },

  setTab(tab: "call" | "notes") {
    state.activeTab = tab;
    emit();
  },

  async startCall(phoneNumber: string, prompt: string): Promise<boolean> {
    try {
      state.status = "calling";
      state.transcript = [];
      state.notes = emptyNotes();
      state.notes.live_summary = "Se lansează apelul...";
      emit();

      console.log(`[AICallStore] Starting call to ${phoneNumber}`);
      const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
      const response = await fetch("/api/ai-call/dial", {
        method: "POST",
        headers,
        body: JSON.stringify({ phoneNumber, prompt })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let finalErrorMsg = errorText;
        try {
          const parsed = JSON.parse(errorText);
          finalErrorMsg = parsed.details || parsed.error || errorText;
        } catch {
          // Keep raw text if not valid JSON
        }
        throw new Error(finalErrorMsg);
      }

      const data = await response.json();
      if (data.success) {
        state.currentCallSid = data.callSid;
        state.status = "calling";
        emit();
        
        // Connect live audio updates WS channel
        connectWebSocket(data.callSid);
        return true;
      } else {
        throw new Error(data.error || "A apărut o eroare la apelare.");
      }
    } catch (e: any) {
      console.error("[AICallStore] Call start failed:", e);
      state.status = "failed";
      // Ensure we don't display raw 'Error:' prefix if message contains the clean translation
      const cleanMessage = e.message ? e.message.replace(/^Error:\s*/i, "") : e.toString();
      state.notes.live_summary = `Eroare apel: ${cleanMessage}`;
      emit();
      return false;
    }
  },

  endCall() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "end_call" }));
    }
    state.status = "ended";
    emit();
    if (socket) {
      socket.close();
      socket = null;
    }
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  },

  reset() {
    this.endCall();
    state = {
      currentCallSid: null,
      status: "idle",
      transcript: [],
      notes: emptyNotes(),
      isModalOpen: false,
      activeTab: "call"
    };
    emit();
  }
};
