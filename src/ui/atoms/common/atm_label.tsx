import React from "react";

export interface AtmLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const AtmLabel: React.FC<AtmLabelProps> = ({
  children,
  required = false,
  className = "",
  ...props
}) => {
  return (
    <label
      className={`block text-[11px] font-semibold text-gray-700 tracking-wide select-none ${className}`}
      {...props}
    >
      {children}
      {required && <span className="text-rose-500 ml-1">*</span>}
    </label>
  );
};
