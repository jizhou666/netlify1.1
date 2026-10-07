import { colorSwatchToken } from "@/lib/inventory";
import { cn } from "@/lib/utils";

const SWATCH_BG: Record<string, string> = {
  "swatch-yellow": "bg-swatch-yellow",
  "swatch-red": "bg-swatch-red",
  "swatch-orange": "bg-swatch-orange",
  "swatch-green": "bg-swatch-green",
  "swatch-blue": "bg-swatch-blue",
  "swatch-pink": "bg-swatch-pink",
  "swatch-violet": "bg-swatch-violet",
  "swatch-white": "bg-swatch-white border border-rule",
  "swatch-black": "bg-swatch-black",
  "swatch-brown": "bg-swatch-brown",
  "swatch-gray": "bg-swatch-gray",
  "swatch-gold": "bg-swatch-gold",
  "swatch-unknown": "bg-swatch-unknown",
};

export function ColorDot({ color, className }: { color: string; className?: string }) {
  const token = colorSwatchToken(color);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        SWATCH_BG[token] ?? "bg-swatch-unknown",
        className,
      )}
    />
  );
}
