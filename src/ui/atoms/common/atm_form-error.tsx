import React from "react";

export interface AtmFormErrorProps {
  message?: string;
  className?: string;
}

export const AtmFormError: React.FC<AtmFormErrorProps> = ({ message, className = "" }) => {
  if (!message) return null;
  return (
    <p className={`text-[10px] text-rose-600 font-medium tracking-tight mt-1 flex items-center gap-1 ${className}`}>
      <span>{message}</span>
    </p>
  );
};
