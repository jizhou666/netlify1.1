import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function parseNonNeg(raw: string) {
  if (raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function QtyFields({
  id,
  cartons,
  sets,
  onCartons,
  onSets,
}: {
  id: string;
  cartons: number;
  sets: number;
  onCartons: (n: number) => void;
  onSets: (n: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-cartons`}>件数</Label>
        <div className="relative">
          <Input
            id={`${id}-cartons`}
            type="number"
            min={0}
            inputMode="numeric"
            value={cartons}
            onChange={(e) => onCartons(parseNonNeg(e.target.value))}
            className="pr-8 tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
            件
          </span>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-sets`}>套数</Label>
        <div className="relative">
          <Input
            id={`${id}-sets`}
            type="number"
            min={0}
            inputMode="numeric"
            value={sets}
            onChange={(e) => onSets(parseNonNeg(e.target.value))}
            className="pr-8 tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
            套
          </span>
        </div>
      </div>
    </div>
  );
}
