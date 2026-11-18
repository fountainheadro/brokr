import React from "react";
import { Calendar } from "lucide-react";
import { AtmInputText } from "../../atoms/common/atm_input-text";

export interface MolDatePickerProps {
  value: string;
  onChange: (date: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const MolDatePicker: React.FC<MolDatePickerProps> = ({
  value,
  onChange,
  disabled = false,
  className = "",
}) => {
  return (
    <div className={`relative flex items-center ${className}`}>
      <AtmInputText
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        leftIcon={<Calendar size={14} className="text-[#BE9662]" />}
      />
    </div>
  );
};
