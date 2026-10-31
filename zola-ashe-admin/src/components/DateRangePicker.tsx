"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

export interface DateRange {
  date_from: string;
  date_to: string;
}

const PRESETS: { label: string; days: number | null }[] = [
  { label: "7 jours", days: 7 },
  { label: "30 jours", days: 30 },
  { label: "90 jours", days: 90 },
  { label: "Tout", days: null },
];

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false);

  const applyPreset = (days: number | null) => {
    if (days === null) onChange({ date_from: "", date_to: "" });
    else {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      onChange({ date_from: toISODate(from), date_to: toISODate(to) });
    }
    setOpen(false);
  };

  const label = value.date_from && value.date_to ? `${value.date_from} → ${value.date_to}` : "Toute la période";

  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.5rem 1rem", background: "var(--bg-1)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", color: "var(--cream)", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>
        📅 {label}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 0.4rem)", right: 0, zIndex: 20, background: "var(--bg-1)", border: "1px solid var(--line-soft)", borderRadius: "var(--radius)", padding: "0.85rem", minWidth: 260, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {PRESETS.map((p) => <button key={p.label} type="button" onClick={() => applyPreset(p.days)} style={{ fontSize: "0.74rem", padding: "0.28rem 0.6rem", borderRadius: 5, border: "1px solid var(--line-soft)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>{p.label}</button>)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {["date_from", "date_to"].map((key) => (
              <label key={key} style={{ fontSize: "0.74rem", color: "var(--muted-2)" }}>
                {key === "date_from" ? "Du" : "Au"}
                <input type="date" value={value[key as keyof DateRange]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} style={{ display: "block", width: "100%", marginTop: "0.2rem", padding: "0.4rem 0.5rem", borderRadius: 5, border: "1px solid var(--line-soft)", background: "transparent", color: "var(--cream)", fontSize: "0.82rem" }} />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
            <Button variant="ghost" onClick={() => setOpen(false)}>Fermer</Button>
          </div>
        </div>
      )}
    </div>
  );
}