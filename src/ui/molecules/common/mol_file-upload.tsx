import React, { useRef, useState } from "react";
import { UploadCloud, File, X } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export interface MolFileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  maxSizeMb?: number;
  label?: string;
  className?: string;
}

export const MolFileUpload: React.FC<MolFileUploadProps> = ({
  onFileSelect,
  accept = "image/*,.pdf,.doc,.docx",
  maxSizeMb = 15,
  label = "Încarcă fișier sau trage aici",
  className = "",
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setError(null);
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`Fișierul depășește limita maximă de ${maxSizeMb} MB`);
      return;
    }
    setSelectedFile(file);
    onFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center select-none ${
          isDragging
            ? "border-[#BE9662] bg-[#BE9662]/5"
            : "border-gray-200 bg-gray-50/50 hover:bg-gray-50 hover:border-gray-300"
        }`}
        style={{ borderRadius: designTokens.radius.card }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />

        <div className="w-10 h-10 rounded-full bg-white border border-gray-200 text-[#BE9662] flex items-center justify-center mb-3 shadow-2xs">
          <UploadCloud size={20} />
        </div>

        <p className="text-xs font-semibold text-gray-800">{label}</p>
        <p className="text-[10px] text-gray-400 mt-1">
          Formate acceptate: imagini, documente (max. {maxSizeMb} MB)
        </p>
      </div>

      {selectedFile && (
        <div
          className="mt-3 px-3 py-2 bg-white border border-gray-200 flex items-center justify-between text-xs shadow-2xs"
          style={{ borderRadius: designTokens.radius.standard }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <File size={14} className="text-[#BE9662] shrink-0" />
            <span className="truncate font-medium text-gray-800">{selectedFile.name}</span>
            <span className="text-[10px] text-gray-400 shrink-0">
              ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedFile(null);
            }}
            className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && <p className="text-[10px] text-rose-600 font-medium mt-1">{error}</p>}
    </div>
  );
};
