import React from "react";
import { AtmLabel } from "../../atoms/common/atm_label";
import { AtmFormError } from "../../atoms/common/atm_form-error";

export interface MolFormFieldProps {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export const MolFormField: React.FC<MolFormFieldProps> = ({
  label,
  required = false,
  error,
  hint,
  children,
  className = "",
}) => {
  return (
    <div className={`w-full space-y-1 ${className}`}>
      {label && <AtmLabel required={required}>{label}</AtmLabel>}
      {children}
      {error ? (
        <AtmFormError message={error} />
      ) : hint ? (
        <p className="text-[10px] text-gray-400 font-medium">{hint}</p>
      ) : null}
    </div>
  );
};
