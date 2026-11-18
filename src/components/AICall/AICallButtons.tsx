import React, { useState, useEffect } from "react";
import { Phone, FileAudio, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { AICallStore, CallStoreState } from "./AICallStore";

export const AICallButtons: React.FC = () => {
  const [storeState, setStoreState] = useState<CallStoreState>(AICallStore.getState());

  useEffect(() => {
    const unsub = AICallStore.subscribe((newState) => {
      setStoreState(newState);
    });
    return unsub;
  }, []);

  const { status } = storeState;

  // Compute color accents based on current call status
  const getCallButtonClass = () => {
    switch (status) {
      case "calling":
        return "bg-amber-500 text-white animate-pulse shadow-md border-amber-500";
      case "connected":
        return "bg-green-500 text-white animate-bounce shadow-md border-green-500";
      case "failed":
        return "bg-red-50 text-red-500 border border-red-100 hover:bg-red-100";
      case "ended":
        return "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200";
      default:
        return "bg-white hover:bg-orange-50 text-gray-700 hover:text-[--color-accent] border border-gray-100 shadow-sm";
    }
  };

  const getNotesButtonClass = () => {
    if (status === "connected" || status === "calling") {
      return "bg-[#BE9662]/20 text-[#051D35] hover:bg-[#BE9662]/30 border border-[#BE9662]/40 animate-pulse";
    }
    return "bg-white hover:bg-gray-50 text-gray-700 border border-gray-100 shadow-sm";
  };

  return (
    <div className="flex items-center gap-2" id="ai-call-header-buttons">
      {/* 1. AI Call Button */}
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => AICallStore.openModal("call")}
        className={`w-12 h-12 flex items-center justify-center rounded-full cursor-pointer transition-all ${getCallButtonClass()}`}
        title={
          status === "calling"
            ? "Apel în curs de lansare..."
            : status === "connected"
            ? "Apel AI Conectat! Click pentru a vizualiza."
            : "Lansează Apel Inteligent AI"
        }
      >
        {status === "calling" ? (
          <Loader2 size={20} className="animate-spin text-white" />
        ) : (
          <Phone size={20} strokeWidth={2.2} />
        )}
      </motion.button>

      {/* 2. Live Notes Button */}
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => AICallStore.openModal("notes")}
        className={`w-12 h-12 flex items-center justify-center rounded-full cursor-pointer transition-all ${getNotesButtonClass()}`}
        title="Notițe Live și Transcriere"
      >
        <FileAudio size={20} strokeWidth={2.2} />
      </motion.button>
    </div>
  );
};
