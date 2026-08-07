"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Rect = { left: number; top: number; width: number; height: number };

type Props = {
  imageUrl: string;
  open: boolean;
  onConfirm: (blob: Blob) => void;
  onSkip: () => void;
  onCancel: () => void;
};

const MIN = 50;

export function ImageCropModal({ imageUrl, open, onConfirm, onSkip, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<Rect>({ left: 40, top: 40, width: 200, height: 200 });
  const drag = useRef<{
    mode: string;
    startX: number;
    startY: number;
    start: Rect;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const img = imgRef.current;
    if (!img) return;
    const init = () => {
      const w = img.clientWidth;
      const h = img.clientHeight;
      const size = Math.min(w, h) * 0.7;
      setBox({
        left: (w - size) / 2,
        top: (h - size) / 2,
        width: size,
        height: size,
      });
    };
    if (img.complete) init();
    else img.onload = init;
  }, [open, imageUrl]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    const container = containerRef.current;
    if (!d || !container) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    let { left, top, width, height } = d.start;

    if (d.mode === "drag") {
      left = Math.max(0, Math.min(maxW - width, d.start.left + dx));
      top = Math.max(0, Math.min(maxH - height, d.start.top + dy));
    } else {
      const corner = d.mode.replace("resize-", "");
      if (corner.includes("e")) width = Math.max(MIN, d.start.width + dx);
      if (corner.includes("s")) height = Math.max(MIN, d.start.height + dy);
      if (corner.includes("w")) {
        const actual = Math.min(dx, d.start.width - MIN);
        left = d.start.left + actual;
        width = d.start.width - actual;
      }
      if (corner.includes("n")) {
        const actual = Math.min(dy, d.start.height - MIN);
        top = d.start.top + actual;
        height = d.start.height - actual;
      }
      left = Math.max(0, left);
      top = Math.max(0, top);
      if (left + width > maxW) width = maxW - left;
      if (top + height > maxH) height = maxH - top;
    }
    setBox({ left, top, width, height });
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
    };
  }, [onPointerMove, endDrag]);

  function start(mode: string, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...box },
    };
  }

  async function confirm() {
    const img = imgRef.current;
    if (!img) return;
    const scale = img.naturalWidth / img.clientWidth;
    const x = box.left * scale;
    const y = box.top * scale;
    const w = box.width * scale;
    const h = box.height * scale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9)
    );
    if (blob) onConfirm(blob);
  }

  if (!open) return null;

  const handles = ["nw", "ne", "sw", "se"] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-card p-4 shadow-xl">
        <h2 className="font-display text-xl">Crop label</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag the box or corners to frame the label text, then confirm.
        </p>
        <div
          ref={containerRef}
          className="relative mt-4 max-h-[60vh] overflow-hidden rounded-lg bg-muted"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Crop source"
            className="block max-h-[60vh] w-full object-contain"
            draggable={false}
          />
          <div
            className="absolute border-2 border-primary bg-primary/10"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              touchAction: "none",
            }}
            onPointerDown={(e) => start("drag", e)}
          >
            {handles.map((h) => (
              <span
                key={h}
                className="absolute h-3 w-3 rounded-sm bg-primary"
                style={{
                  ...(h.includes("n") ? { top: -6 } : { bottom: -6 }),
                  ...(h.includes("w") ? { left: -6 } : { right: -6 }),
                }}
                onPointerDown={(e) => start(`resize-${h}`, e)}
              />
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onSkip}>
            Skip crop
          </Button>
          <Button onClick={confirm}>Crop &amp; continue</Button>
        </div>
      </div>
    </div>
  );
}
