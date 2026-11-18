import React from "react";
import { Search } from "lucide-react";
import { AtmInputText, AtmInputTextProps } from "../../atoms/common/atm_input-text";

export interface MolSearchFieldProps extends Omit<AtmInputTextProps, "type"> {
  shortcut?: string;
}

export const MolSearchField: React.FC<MolSearchFieldProps> = ({
  shortcut = "⌘K",
  placeholder = "Caută...",
  className = "",
  ...props
}) => {
  return (
    <div className={`relative flex items-center w-full ${className}`}>
      <AtmInputText
        type="search"
        placeholder={placeholder}
        leftIcon={<Search size={14} className="text-gray-400" />}
        rightIcon={
          shortcut ? (
            <kbd className="hidden sm:inline-block text-[9px] font-mono font-semibold px-1 py-1 rounded bg-gray-100 text-gray-500 border border-gray-200">
              {shortcut}
            </kbd>
          ) : undefined
        }
        {...props}
      />
    </div>
  );
};
