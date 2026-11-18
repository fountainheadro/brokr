import React from 'react';
import { Download, Copy, Check, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getCleanDisplayImageUrl, getThumbnailImageUrl } from '../utils/imageUtils';

export const FormLabel = ({ children }: { children: React.ReactNode }) => (
  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
    {children}
  </label>
);

export const FormInput = ({ value: initialValue, placeholder, unit, type = "text", onChange, onBlur, onFocus }: { value?: string, placeholder?: string, unit?: string, type?: string, onChange?: (val: string) => void, onBlur?: (val: string) => void, onFocus?: () => void }) => {
  const [value, setValue] = React.useState(initialValue || "");

  React.useEffect(() => {
    setValue(initialValue || "");
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue(val);
    if (onChange) onChange(val);
  };

  return (
    <div className="relative w-full">
      <input
        type={type}
        value={value}
        onChange={handleChange}
        onBlur={() => onBlur?.(value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className={`input-base w-full font-normal ${unit ? 'pr-10' : ''} ${type === 'date' ? 'uppercase text-[12px] font-normal' : ''}`}
      />
      {unit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-normal text-gray-400 pointer-events-none">
          {unit}
        </span>
      )}
    </div>
  );
};

export const FormInputWithCounter = ({ value: initialValue, limit = 70, onChange, onBlur }: { value?: string, limit?: number, onChange?: (val: string) => void, onBlur?: () => void }) => {
  const [value, setValue] = React.useState(initialValue || "");

  React.useEffect(() => {
    setValue(initialValue || "");
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue(val);
    if (onChange) onChange(val);
  };

  const count = value.length;
  const isOverLimit = count > limit;

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        className={`input-base w-full font-normal pr-10 ${isOverLimit ? 'border-red-500 focus:border-red-500' : ''}`}
      />
      <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono ${isOverLimit ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
        {count}
      </span>
    </div>
  );
};

export const FormSelect = ({ value: initialValue, placeholder, options = [], onChange, onBlur, showEmpty = true }: { value?: string, placeholder?: string, options?: string[], onChange?: (val: string) => void, onBlur?: () => void, showEmpty?: boolean }) => {
  const selectOptions = showEmpty ? (options.includes("") ? options : ["", ...options]) : options;

  const getResolvedValue = (v?: string) => {
    const val = v || "";
    if (selectOptions.includes(val)) return val;
    return selectOptions[0] || "";
  };

  const [value, setValue] = React.useState(getResolvedValue(initialValue));

  React.useEffect(() => {
    setValue(getResolvedValue(initialValue));
  }, [initialValue, options]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setValue(val);
    if (onChange) onChange(val);
  };

  return (
    <div className="relative w-full">
      <select
        className="input-base w-full font-normal appearance-none pr-8 cursor-pointer"
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
      >
        {selectOptions.map((opt, idx) => (
          <option key={idx} value={opt}>
            {opt === "" ? (placeholder || "") : opt}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
        <svg width="8" height="5" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
};

export const FormCheckbox = ({ label, checked, onChange }: { label: string, checked: boolean, onChange?: (val: boolean) => void }) => {
  return (
    <label className="flex items-center gap-2 group cursor-pointer select-none py-1 h-7 relative">
      <div className="relative w-4 h-4 shrink-0 flex items-center justify-center">
        <input
          type="checkbox"
          checked={!!checked}
          onChange={(e) => {
            const newVal = e.target.checked;
            onChange?.(newVal);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 peer"
        />
        
        <div className={`w-3.5 h-3.5 rounded border transition-all duration-150 flex items-center justify-center ${
          checked 
          ? 'bg-[#051D35] border-[#051D35]' 
          : 'bg-white border-gray-300 group-hover:border-gray-400'
        }`}>
          <AnimatePresence>
            {checked && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.1, ease: "easeOut" }}
                className="flex items-center justify-center"
              >
                <Check size={10} strokeWidth={3} className="text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <span className="text-[12px] font-normal text-gray-700 transition-colors leading-none">{label}</span>
    </label>
  );
};

export const FormRadio = ({ label, checked, onChange }: { label: string, checked: boolean, onChange?: (val: boolean) => void }) => {
  return (
    <label className="flex items-center gap-2 group cursor-pointer select-none py-1 h-7 relative">
      <div className="relative w-4 h-4 shrink-0 flex items-center justify-center">
        <input
          type="radio"
          checked={checked}
          onChange={() => {
            onChange?.(true);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 peer"
        />

        <div className={`w-3.5 h-3.5 rounded-full border transition-all duration-150 flex items-center justify-center ${
          checked 
          ? 'border-[#051D35]' 
          : 'bg-white border-gray-300 group-hover:border-gray-400'
        }`}>
          <AnimatePresence>
            {checked && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.1, ease: "easeOut" }}
                className="w-1.5 h-1.5 bg-[#051D35] rounded-full"
              />
            )}
          </AnimatePresence>
        </div>
      </div>
      <span className="text-[12px] font-normal text-gray-700 transition-colors leading-none">{label}</span>
    </label>
  );
};

export const FormRadioBar = ({ options, activeValue: initialActive, onChange }: { options: string[], activeValue?: string, onChange?: (val: string) => void }) => {
  const [active, setActive] = React.useState(initialActive || "");

  React.useEffect(() => {
    setActive(initialActive || "");
  }, [initialActive]);

  const handleSelect = (opt: string) => {
    setActive(opt);
    if (onChange) onChange(opt);
  };

  return (
    <div className="flex flex-wrap gap-2 w-full">
      {options.map((opt) => {
        const isActive = String(active || "").toLowerCase() === String(opt || "").toLowerCase();
        return (
          <button
            key={opt}
            type="button"
            onClick={() => handleSelect(opt)}
            className={`px-3 h-8 text-[12px] font-medium rounded-md border transition-all flex-1 min-w-[90px] ${
              isActive 
                ? 'bg-[#051D35] border-[#051D35] text-white shadow-xs' 
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
};

export const EditableMultiSelect = ({ label, options, initialSelected = [], onChange }: { label: string, options: string[], initialSelected?: string[], onChange?: (val: string[]) => void }) => {
  const [selected, setSelected] = React.useState<string[]>(initialSelected);
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setSelected(initialSelected);
  }, [JSON.stringify(initialSelected)]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (option: string) => {
    let nextSelected: string[];
    if (selected.includes(option)) {
      nextSelected = selected.filter(item => item !== option);
    } else {
      nextSelected = [...selected, option];
    }
    setSelected(nextSelected);
    if (onChange) onChange(nextSelected);
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="input-base min-h-[48px] h-auto w-full px-4 py-2 pr-12 flex flex-wrap gap-2 cursor-pointer !rounded-[8px]"
      >
        {selected.length === 0 ? (
          <span className="text-[15px] font-normal text-[--color-text-placeholder] self-center">Selectează {label}</span>
        ) : (
          selected.map(item => (
            <span key={item} className="bg-gray-50 border border-gray-200 text-gray-700 text-[11px] font-normal px-3 py-1 rounded-[4px] flex items-center gap-2 self-center">
              {item}
              <Check size={10} className="text-gray-400" />
            </span>
          ))
        )}
      </div>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[--color-text-placeholder]">
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-2 bg-white border border-[--color-border] rounded-[8px] shadow-soft max-h-60 overflow-y-auto p-2 custom-scrollbar">
          {options.map(option => (
            <div 
              key={option}
              onClick={() => toggleOption(option)}
              className={`flex items-center justify-between px-4 py-3 rounded-[12px] cursor-pointer transition-colors ${selected.includes(option) ? 'bg-gray-50 text-[--color-text-main]' : 'hover:bg-gray-50 text-[--color-text-secondary]'}`}
            >
              <span className="text-[14px] font-normal">{option}</span>
              {selected.includes(option) && <Check size={16} className="text-[--color-accent]" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const FormGrid = ({ children, cols = 3, className = "" }: { children: React.ReactNode, cols?: number, className?: string }) => (
  <div 
    className={`grid gap-4 mb-4 ${className}`}
    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
  >
    {children}
  </div>
);

export const SectionHeader = ({ children }: { children: React.ReactNode }) => (
  <h3 className="font-title text-[14px] font-semibold text-[--color-text-main] tracking-wider mb-4 mt-2">
    {children}
  </h3>
);

export const FormDivider = () => (
  <div className="w-[calc(100%+40px)] -mx-5 border-b border-[#e5e7eb] my-10" />
);

export const PromoCard = ({ 
  bgImage, 
  avantaje = [],
  dotari = [],
  locatie = [],
  phone = "0742 290 816",
  propertyId = "",
  titleText = "Pe scurt despre această proprietate:",
  onGenerated,
  onClick
}: { 
  bgImage: string, 
  avantaje?: string[],
  dotari?: string[],
  locatie?: string[],
  phone?: string,
  propertyId?: string,
  titleText?: string,
  onGenerated?: (url: string) => void,
  onClick?: () => void 
}) => {
  const [dataUrl, setDataUrl] = React.useState<string>("");
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [hasCanvasError, setHasCanvasError] = React.useState<boolean>(false);

  React.useEffect(() => {
    setIsLoading(true);
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setHasCanvasError(true);
      setIsLoading(false);
      return;
    }

    const renderCanvas = (imgElement?: HTMLImageElement) => {
      try {
        // Dimensions & symmetric padding constraints
        const outerFrameMargin = 64; // Frame border offset
        const innerPadding = 64;      // Padding inside white border frame
        
        const contentLeft = outerFrameMargin + innerPadding; // 128px
        const contentRight = 1920 - outerFrameMargin - innerPadding; // 1792px
        const contentWidth = contentRight - contentLeft; // 1664px
        
        const contentTop = outerFrameMargin + innerPadding; // 128px
        const contentBottom = 1080 - outerFrameMargin - innerPadding; // 952px

        // 1. Solid Dark Background fallback
        ctx.fillStyle = "#141212";
        ctx.fillRect(0, 0, 1920, 1080);

        // 2. Render background cover image if available
        if (imgElement && imgElement.complete && imgElement.naturalWidth > 0) {
          const iw = imgElement.naturalWidth;
          const ih = imgElement.naturalHeight;
          const targetAspect = 1920 / 1080;
          let sx = 0, sy = 0, sw = iw, sh = ih;
          if (iw / ih > targetAspect) {
            sw = ih * targetAspect;
            sx = (iw - sw) / 2;
          } else {
            sh = iw / targetAspect;
            sy = (ih - sh) / 2;
          }
          ctx.drawImage(imgElement, sx, sy, sw, sh, 0, 0, 1920, 1080);
        }

        // 3. Black overall translucent overlay (75% opacity)
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(0, 0, 1920, 1080);

        // 4. White frame border (chenar) run at exactly outerFrameMargin (64px) from edge
        ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
        ctx.lineWidth = 2;
        ctx.strokeRect(outerFrameMargin, outerFrameMargin, 1920 - (outerFrameMargin * 2), 1080 - (outerFrameMargin * 2));

        // Helper function for wrapping text lines cleanly
        const wrapText = (text: string, maxWidth: number) => {
          const words = text.split(" ");
          const lines: string[] = [];
          let currentLine = words[0] || "";

          for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
              currentLine += " " + word;
            } else {
              lines.push(currentLine);
              currentLine = word;
            }
          }
          lines.push(currentLine);
          return lines;
        };

        // 5. Title
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 50px 'Lato', sans-serif";
        const titleY = contentTop + 44; // Baseline of the 50px title (128 + 44 = 172px)
        ctx.fillText(titleText, contentLeft, titleY);

        // Columns layout - 3 Columns with 48px gap
        const columnGap = 48;
        const columnWidth = (contentWidth - (columnGap * 2)) / 3; // (1664 - 96) / 3 = 522.66px
        const col1Left = contentLeft;
        const col2Left = contentLeft + columnWidth + columnGap;
        const col3Left = col2Left + columnWidth + columnGap;

        // Gap requested: exactly 64px of blank vertical space between the bottom of the 50px title and the top of the 34px column titles.
        const colTitleY = titleY + 98;

        // 6. Draw Columns: labels and bullet points with multiline wrap
        const drawColumn = (title: string, list: string[], startX: number) => {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 34px 'Lato', sans-serif";
          ctx.fillText(title, startX, colTitleY);

          let currentY = colTitleY + 48;
          list.slice(0, 5).forEach((item) => {
            // Draw bullet character
            ctx.font = "bold 27px 'Lato', sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.fillText("•", startX, currentY);

            // Draw bullet text
            ctx.font = "500 27px 'Lato', sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            
            const lines = wrapText(item, columnWidth - 40);
            lines.forEach((line, idx) => {
              ctx.fillText(line, startX + 30, currentY + (idx * 38));
            });
            currentY += (lines.length * 38) + 16; // Advance spacing cleanly
          });
        };

        drawColumn("Avantaje", avantaje, col1Left);
        drawColumn("Dotări", dotari, col2Left);
        drawColumn("Împrejurimi", locatie, col3Left);

        // 7. Footer alignment at the bottom
        const boxW = 460;
        const boxH = 180;
        const boxX = contentRight - boxW;
        const _boxYCalculated = contentBottom - boxH;
        // Keep the phone box at 150 offset, or slightly taller by aligning to contentBottom
        const boxY = _boxYCalculated;

        // Draw Phone Box panel
        ctx.fillStyle = "rgba(20, 18, 18, 0.55)";
        ctx.fillRect(boxX, boxY, boxW, boxH);

        // Border
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Phone text
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 44px 'Lato', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(phone, boxX + (boxW / 2), boxY + 80);

        // Property ID text
        ctx.font = "500 21px 'Lato', sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillText(`Mentioneaza codul proprietatii #${propertyId || ""}`, boxX + (boxW / 2), boxY + 130);
        ctx.textAlign = "left"; // reset alignment

        // Draw Left Footer strings vertically aligned at the bottom (stacked from bottom-up)
        const textMaxW = contentWidth - boxW - innerPadding; // 1664 - 460 - 64 = 1140px
        
        // Draw helper string first at the bottom line
        ctx.font = "500 21px 'Lato', sans-serif";
        ctx.fillStyle = "#d1d5db";
        const helperTextLines = wrapText("Consultanță dedicată, asistență completă în negociere și contractare, plus vizionări rapide cu program flexibil.", textMaxW);
        let nextTextY = contentBottom - 10;
        for (let j = helperTextLines.length - 1; j >= 0; j--) {
          ctx.fillText(helperTextLines[j], contentLeft, nextTextY);
          nextTextY -= 28;
        }

        // Draw bold main prompt string above it - same font size as "Caracteristici" (34px)
        ctx.font = "bold 34px 'Lato', sans-serif";
        ctx.fillStyle = "#ffffff";
        const boldPromptLines = wrapText("Pentru programarea unei vizionări sau informații suplimentare, nu ezita să ne contactezi!", textMaxW);
        nextTextY -= 16; // divider gap
        for (let j = boldPromptLines.length - 1; j >= 0; j--) {
          ctx.fillText(boldPromptLines[j], contentLeft, nextTextY);
          nextTextY -= 44;
        }

        // 8. Divider Line (64px/innerPadding offset above the phone box)
        const dividerY = boxY - innerPadding;
        ctx.beginPath();
        ctx.moveTo(contentLeft, dividerY);
        ctx.lineTo(contentRight, dividerY);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Export to data URL
        const generatedUrl = canvas.toDataURL("image/png");
        setDataUrl(generatedUrl);
        setHasCanvasError(false);
        if (onGenerated) onGenerated(generatedUrl);
      } catch (err) {
        console.warn("Canvas is tainted (CORS restriction), falling back to beautiful HTML rendering", err);
        setHasCanvasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    const handleBgImg = (srcUrl: string) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = srcUrl;
      img.onload = () => renderCanvas(img);
      img.onerror = () => {
        console.warn("Failed to load background image for canvas promo generator: " + srcUrl);
        renderCanvas();
      };
    };

    if (bgImage) {
      handleBgImg(getThumbnailImageUrl(bgImage, 1280));
    } else {
      renderCanvas();
    }
  }, [bgImage, JSON.stringify(avantaje), JSON.stringify(dotari), JSON.stringify(locatie), phone, propertyId, titleText]);

  // Fallback visual structure if CORS fails, or if loading is active
  if (hasCanvasError) {
    return (
      <div 
         onClick={onClick}
         className="relative group rounded-[24px] overflow-hidden border border-gray-100 aspect-[16/10] sm:aspect-[16/9] cursor-pointer bg-neutral-900 shadow-xl text-white select-none w-full"
       >
         {bgImage ? (
           <img 
             src={getThumbnailImageUrl(bgImage, 1280)} 
             alt="Promo Background" 
             decoding="async"
             className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
             referrerPolicy="no-referrer" 
             draggable="false"
           />
         ) : (
           <div className="absolute inset-0 bg-neutral-800" />
         )}
         
         <div className="absolute inset-0 bg-black/75 transition-colors duration-300 group-hover:bg-black/70" />
 
         {/* Outer margin 64px, frame border, content padding 64px inside it */}
         <div className="absolute inset-16 border border-white/20 rounded-[12px] p-16 flex flex-col justify-between overflow-hidden">
           <div>
             <h3 className="font-title text-[14px] sm:text-[18px] md:text-[23px] lg:text-[26px] font-semibold text-white tracking-tight leading-tight mb-8 md:mb-16">
               {titleText}
             </h3>
 
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 md:gap-12">
               <div className="space-y-4">
                 <h4 className="font-title text-[11px] sm:text-[13px] md:text-[15px] font-semibold text-white tracking-wide uppercase opacity-90">
                   Avantaje
                 </h4>
                 <ul className="space-y-3 text-[9px] sm:text-[11px] md:text-[13px] lg:text-[14px] text-white/95 font-medium leading-relaxed">
                   {avantaje.slice(0, 5).map((item, idx) => (
                     <li key={idx} className="flex items-start gap-2">
                       <span className="text-white shrink-0 font-bold">•</span>
                       <span>{item}</span>
                     </li>
                   ))}
                 </ul>
               </div>
 
               <div className="space-y-4">
                 <h4 className="font-title text-[11px] sm:text-[13px] md:text-[15px] font-semibold text-white tracking-wide uppercase opacity-90">
                   Dotări
                 </h4>
                 <ul className="space-y-3 text-[9px] sm:text-[11px] md:text-[13px] lg:text-[14px] text-white/95 font-medium leading-relaxed">
                   {dotari.slice(0, 5).map((item, idx) => (
                     <li key={idx} className="flex items-start gap-2">
                       <span className="text-white shrink-0 font-bold">•</span>
                       <span>{item}</span>
                     </li>
                   ))}
                 </ul>
               </div>

               <div className="space-y-4">
                 <h4 className="font-title text-[11px] sm:text-[13px] md:text-[15px] font-semibold text-white tracking-wide uppercase opacity-90">
                   Împrejurimi
                 </h4>
                 <ul className="space-y-3 text-[9px] sm:text-[11px] md:text-[13px] lg:text-[14px] text-white/95 font-medium leading-relaxed">
                   {locatie.slice(0, 5).map((item, idx) => (
                     <li key={idx} className="flex items-start gap-2">
                       <span className="text-white shrink-0 font-bold">•</span>
                       <span>{item}</span>
                     </li>
                   ))}
                 </ul>
               </div>
             </div>
           </div>
 
           <div className="mt-8">
             <div className="border-t border-white/20 w-full mb-16" />
 
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-16">
               <div className="space-y-2 max-w-[70%]">
                 <p className="text-[11px] sm:text-[13px] md:text-[15px] font-bold text-white leading-snug">
                   Pentru programarea unei vizionări sau informații suplimentare, nu ezita să ne contactezi!
                 </p>
                 <p className="text-[8px] sm:text-[10px] md:text-[12px] lg:text-[13px] text-gray-300 leading-normal font-medium hidden sm:block">
                   Consultanță dedicată, asistență completă în negociere și contractare, plus vizionări rapide cu program flexibil.
                 </p>
               </div>
 
               <div className="shrink-0 self-start md:self-center border border-white/25 rounded-md px-10 py-5 bg-[#141212]/50 backdrop-blur-sm shadow-inner text-center">
                 <span className="text-[11px] sm:text-[14px] md:text-[18px] lg:text-[22px] font-bold text-white tracking-wider block font-sans whitespace-nowrap">
                   {phone}
                 </span>
                 {propertyId && (
                   <span className="text-[7px] sm:text-[9px] md:text-[11px] lg:text-[12px] text-white/85 tracking-tight block font-sans whitespace-nowrap mt-1">
                     Mentioneaza codul proprietatii #{propertyId}
                   </span>
                 )}
               </div>
             </div>
           </div>
         </div>
       </div>
    );
  }

  return (
    <div 
      onClick={onClick}
      className="relative rounded-[24px] overflow-hidden border border-gray-200 select-none shadow-xl cursor-pointer bg-neutral-900 group aspect-[16/10] sm:aspect-[16/9] w-full flex items-center justify-center"
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-white animate-pulse">
           <span className="text-[12px] font-bold tracking-widest text-gray-400">SE GENEREAZĂ IMAGINEA PROMO...</span>
        </div>
      ) : (
        <img 
          src={dataUrl} 
          alt="Generated Promo Landing Card"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.01]"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
};

export const ImageCard = ({ 
  imageData, 
  category, 
  onClick,
  onMoveCategory,
  noHoverEffect 
}: { 
  imageData: { original: string }, 
  category: string, 
  onClick?: () => void,
  onMoveCategory?: (targetCategory: string) => void,
  noHoverEffect?: boolean
}) => {
  const proxiedUrl = getCleanDisplayImageUrl(imageData.original);
  const gridThumbnailUrl = getThumbnailImageUrl(imageData.original, 480);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(proxiedUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${category}-photo.png`;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div 
      className="relative group rounded-[8px] overflow-hidden border border-gray-200 bg-white flex flex-col shadow-xs"
    >
      <div 
        onClick={onClick}
        className="relative aspect-video cursor-pointer bg-gray-100 overflow-hidden"
        title="Click pentru a vizualiza în format original"
      >
        {imageData.original ? (
          <img 
            src={gridThumbnailUrl} 
            alt={category} 
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover transition-transform duration-300 ${noHoverEffect ? '' : 'group-hover:scale-105'}`} 
            referrerPolicy="no-referrer" 
            draggable="true"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400 text-xs">
            No Image
          </div>
        )}
      </div>

      {/* Control bar for slot relocation & download */}
      <div className="p-2 bg-gray-50/90 border-t border-gray-100 flex items-center justify-between gap-1">
        {onMoveCategory ? (
          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] text-gray-400 font-semibold shrink-0">Slot:</span>
            <select
              value={category}
              onChange={(e) => onMoveCategory(e.target.value)}
              className="w-full text-[11px] font-normal bg-white border border-gray-200 rounded px-2 py-1 text-gray-700 hover:border-gray-300 focus:outline-none cursor-pointer truncate"
            >
              <option value="living">Living</option>
              <option value="bucatarie">Bucătărie</option>
              <option value="camera">Dormitor / Cameră</option>
              <option value="baie">Baie</option>
              <option value="alteSpatii">Alte Spații</option>
            </select>
          </div>
        ) : (
          <span className="text-[10px] text-gray-400 capitalize truncate">{category}</span>
        )}

        <button
          onClick={handleDownload}
          className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors shrink-0"
          title="Descarcă imagine"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  );
};
