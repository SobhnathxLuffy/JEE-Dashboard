"use client";

// ─── FileDrop — one drop-target design for every upload surface ──────────────
// Drag a file in (or click / keyboard-activate to browse). The caller owns
// validation + toasts; this component only collects files. Used by Papers
// upload, JSON backup restore, question JSON import, figure attach, key-file.
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function FileDrop({
  accept,
  onFiles,
  label,
  hint,
  multiple = false,
  compact = false,
  className,
}: {
  accept: string;
  onFiles: (files: File[]) => void;
  label: string;
  hint?: string;
  multiple?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      aria-label={label}
      className={cn(
        "press cursor-pointer rounded-lg border border-dashed text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        compact ? "px-3 py-2.5" : "px-4 py-7",
        over
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border hover:border-primary/50 hover:bg-accent/40",
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Upload
        className={cn(
          "mx-auto mb-1 h-5 w-5",
          compact ? "h-4 w-4" : "h-6 w-6",
          over ? "text-primary" : "text-muted-foreground"
        )}
        aria-hidden="true"
      />
      <div className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
        {over ? "Drop to attach" : label}
      </div>
      {hint ? (
        <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
      ) : null}
    </div>
  );
}
