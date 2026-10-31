"use client";

import { useCallback, useEffect, useState } from "react";

import { livesApi } from "@/lib/endpoints";
import type { Branche, LivePlatform, LiveSession, LiveStatus, Paginated } from "@/lib/types";
import { Alert, Button, Input, Select, Textarea, errorMessage } from "@/components/ui";
import { ConfirmModal, Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

// ── Palette ───────────────────────────────────────────────────────────────────

const BRANCHE_COLOR: Record<string, string> = {
  MEMBRE: "#c9a227", GENERALE: "#c9a227", FEMME: "#b5532a", ENFANT: "#52b083",
};
const BRANCHE_BG: Record<string, string> = {
  MEMBRE: "rgba(201,162,39,0.13)", GENERALE: "rgba(201,162,39,0.13)", FEMME: "rgba(181,83,42,0.11)", ENFANT: "rgba(82,176,131,0.11)",
};
const BRANCHE_LABEL: Record<string, string> = {
  MEMBRE: "Membres", GENERALE: "Membres", FEMME: "Femmes", ENFANT: "Enfants",
};
const STATUS_COLOR: Record<LiveStatus, string> = {
  PLANIFIE: "#c9a227", EN_COURS: "#e05555", TERMINE: "#9a9284",
};
const STATUS_BG: Record<LiveStatus, string> = {
  PLANIFIE: "rgba(201,162,39,0.12)", EN_COURS: "rgba(224,85,85,0.12)", TERMINE: "rgba(154,146,132,0.12)",
};
const STATUS_LABEL: Record<LiveStatus, string> = {
  PLANIFIE: "Planifié", EN_COURS: "En cours", TERMINE: "Terminé",
};
const PLATFORM_LABEL: Record<LivePlatform, string> = {
  ZOOM: "Zoom", YOUTUBE: "YouTube Live", MEET: "Google Meet", TEAMS: "Teams",
};
const PLATFORM_COLOR: Record<LivePlatform, string> = {
  ZOOM: "#2D8CFF", YOUTUBE: "#FF0000", MEET: "#34A853", TEAMS: "#6264A7",
};

// ── Helpers date ──────────────────────────────────────────────────────────────

const MONTH_FR  = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAY_LONG  = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const DAY_SHORT = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  r.setHours(0, 0, 0, 0);
  return r;
}
function getWeekDays(d: Date): Date[] {
  const mon = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(mon); x.setDate(mon.getDate() + i); return x;
  });
}
function getMonthGrid(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const day   = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() + (day === 0 ? -6 : 1 - day));
  return Array.from({ length: 42 }, (_, i) => {
    const x = new Date(start); x.setDate(start.getDate() + i); return x;
  });
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function forDay(sessions: LiveSession[], d: Date) {
  return sessions
    .filter((s) => isSameDay(new Date(s.scheduled_at), d))
    .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
}
function fmtT(d: Date) {
  return `${String(d.getHours()).padStart(2,"0")}h${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtDateLong(d: Date) {
  return `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_FR[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateShort(d: Date) {
  return `${DAY_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTH_FR[d.getMonth()].slice(0, 4)}.`;
}

// ── Vues disponibles ──────────────────────────────────────────────────────────

type LiveView = "month" | "week" | "agenda" | "liste";
const LIVE_VIEWS: { key: LiveView; icon: string; label: string }[] = [
  { key: "month",  icon: "⊞", label: "Mois"    },
  { key: "week",   icon: "⊟", label: "Semaine" },
  { key: "agenda", icon: "☰", label: "Agenda"  },
  { key: "liste",  icon: "≔", label: "Liste"   },
];

// ── Formulaire live ───────────────────────────────────────────────────────────

const EMPTY = {
  title: "", description: "", scheduled_at: "",
  status: "PLANIFIE" as LiveStatus, platform: "ZOOM" as LivePlatform,
  link: "", branche: "MEMBRE" as Branche, replay_url: "",
};

function LiveFormModal({ initial, editing, onClose, onSaved }: {
  initial: typeof EMPTY; editing: number | null;
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [form,    setForm]    = useState(initial);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const payload = { ...form, replay_url: form.replay_url || null };
      if (editing) { await livesApi.update(editing, payload); onSaved("Session mise à jour."); }
      else          { await livesApi.create(payload);          onSaved("Session créée."); }
      onClose();
    } catch (err) { toast(errorMessage(err), "error"); } finally { setLoading(false); }
  };

  return (
    <Modal title={editing ? "Modifier la session" : "Nouvelle session live"} onClose={onClose} maxWidth={640}>
      <form onSubmit={submit}>
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:"0 1rem" }}>
          <Input label="Titre de la session" value={form.title} required
                 onChange={(e) => setForm({...form, title: e.target.value})} />
          <Input label="Date & heure" type="datetime-local" value={form.scheduled_at} required
                 onChange={(e) => setForm({...form, scheduled_at: e.target.value})} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0 1rem" }}>
          <Select label="Plateforme" value={form.platform}
                  onChange={(e) => setForm({...form, platform: e.target.value as LivePlatform})}>
            <option value="ZOOM">Zoom</option>
            <option value="YOUTUBE">YouTube Live</option>
            <option value="MEET">Google Meet</option>
            <option value="TEAMS">Teams</option>
          </Select>
          <Select label="Branche cible" value={form.branche}
                  onChange={(e) => setForm({...form, branche: e.target.value as Branche})}>
            <option value="MEMBRE">Générale</option>
            <option value="FEMME">Femmes</option>
            <option value="ENFANT">Enfants</option>
          </Select>
          <Select label="Statut" value={form.status}
                  onChange={(e) => setForm({...form, status: e.target.value as LiveStatus})}>
            <option value="PLANIFIE">Planifié</option>
            <option value="EN_COURS">En cours</option>
            <option value="TERMINE">Terminé</option>
          </Select>
        </div>
        <Input label="Lien de la session" value={form.link} placeholder="https://zoom.us/j/…" required
               onChange={(e) => setForm({...form, link: e.target.value})} />
        <Textarea
          label="Description" value={form.description} minRows={3}
          placeholder="Résumé de ce qui sera abordé…"
          onChange={(e) => setForm({...form, description: e.target.value})}
        />
        <Input label="Lien replay (après le live)" value={form.replay_url}
               placeholder="https://youtube.com/watch?v=…"
               onChange={(e) => setForm({...form, replay_url: e.target.value})} />
        <div style={{ display:"flex", gap:".6rem", justifyContent:"flex-end", marginTop:".5rem" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>Annuler</Button>
          <Button type="submit" loading={loading}>{editing ? "Enregistrer" : "Créer"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Vue Mensuelle ─────────────────────────────────────────────────────────────

function MonthView({ date, sessions, onDayClick, onSessionClick }: {
  date: Date; sessions: LiveSession[];
  onDayClick: (d: Date) => void; onSessionClick: (s: LiveSession) => void;
}) {
  const grid    = getMonthGrid(date);
  const today   = new Date();
  const curMonth = date.getMonth();

  return (
    <div style={{ border:"1px solid var(--line-soft)", borderRadius:"var(--radius)", overflow:"hidden", background:"var(--bg-1)" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)" }}>
        {DAY_SHORT.map((d) => (
          <div key={d} style={{ padding:"0.6rem 0", textAlign:"center", fontSize:"0.73rem", fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.07em", background:"var(--bg-2)", borderBottom:"1px solid var(--line-soft)" }}>{d}</div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)" }}>
        {grid.map((day, i) => {
          const dayItems  = forDay(sessions, day);
          const inMonth   = day.getMonth() === curMonth;
          const todayCell = isSameDay(day, today);
          const isLastRow = i >= 35;
          const isLastCol = (i + 1) % 7 === 0;
          return (
            <div key={i} data-today={todayCell ? "1" : "0"} onClick={() => onDayClick(day)}
              style={{ minHeight:100, borderRight:isLastCol?"none":"1px solid var(--line-soft)", borderBottom:isLastRow?"none":"1px solid var(--line-soft)", padding:"6px 7px", background:todayCell?"rgba(201,162,39,0.06)":"transparent", cursor:"pointer", transition:"background .12s", opacity:inMonth?1:0.45 }}
              onMouseEnter={(e) => { if (!todayCell) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-2)"; }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.background = el.dataset.today==="1"?"rgba(201,162,39,0.06)":"transparent"; }}
            >
              <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:3 }}>
                <span style={{ width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"0.79rem", fontWeight:todayCell?800:500, color:todayCell?"#fff":inMonth?"var(--cream)":"var(--muted-2)", background:todayCell?"var(--gold)":"transparent" }}>
                  {day.getDate()}
                </span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {dayItems.slice(0, 3).map((s) => (
                  <div key={s.id} onClick={(e) => { e.stopPropagation(); onSessionClick(s); }}
                    style={{ background:BRANCHE_BG[s.branche], borderLeft:`2.5px solid ${BRANCHE_COLOR[s.branche]}`, color:BRANCHE_COLOR[s.branche], borderRadius:"0 4px 4px 0", padding:"2px 5px", fontSize:"0.67rem", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}
                    title={s.title}
                  >
                    {fmtT(new Date(s.scheduled_at))} {s.title}
                  </div>
                ))}
                {dayItems.length > 3 && <div style={{ fontSize:"0.63rem", color:"var(--muted)", paddingLeft:4 }}>+{dayItems.length - 3} de plus</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Vue Hebdomadaire ──────────────────────────────────────────────────────────

const START_H  = 8;
const END_H    = 22;
const ROW_H    = 60;
const DURATION = 1.5;

function WeekView({ date, sessions, onDayClick, onSessionClick }: {
  date: Date; sessions: LiveSession[];
  onDayClick: (d: Date) => void; onSessionClick: (s: LiveSession) => void;
}) {
  const days   = getWeekDays(date);
  const today  = new Date();
  const nowH   = today.getHours() + today.getMinutes() / 60;
  const nowTop = (nowH - START_H) * ROW_H;
  const inWeek = days.some((d) => isSameDay(d, today));
  const hours  = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  const totalH = (END_H - START_H) * ROW_H;
  const TIME_W = 56;

  return (
    <div style={{ border:"1px solid var(--line-soft)", borderRadius:"var(--radius)", overflow:"hidden", background:"var(--bg-1)" }}>
      <div style={{ display:"grid", gridTemplateColumns:`${TIME_W}px repeat(7, 1fr)`, borderBottom:"1px solid var(--line-soft)", background:"var(--bg-2)", position:"sticky", top:0, zIndex:4 }}>
        <div />
        {days.map((d, i) => {
          const isT = isSameDay(d, today);
          return (
            <div key={i} style={{ padding:"0.6rem 0.25rem", textAlign:"center", borderLeft:"1px solid var(--line-soft)", background:isT?"rgba(201,162,39,0.08)":"transparent" }}>
              <div style={{ fontSize:"0.71rem", fontWeight:700, letterSpacing:"0.05em", textTransform:"uppercase", color:isT?"var(--gold-2)":"var(--muted)" }}>{DAY_SHORT[i]}</div>
              <div style={{ width:32, height:32, borderRadius:"50%", margin:"4px auto 0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.1rem", fontWeight:800, background:isT?"var(--gold)":"transparent", color:isT?"#fff":"var(--cream)" }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ overflowY:"auto", maxHeight:540 }}>
        <div style={{ display:"grid", gridTemplateColumns:`${TIME_W}px repeat(7, 1fr)`, height:totalH, position:"relative" }}>
          <div style={{ position:"relative", background:"var(--bg-1)", zIndex:2 }}>
            {hours.map((h) => (
              <div key={h} style={{ position:"absolute", top:(h-START_H)*ROW_H-8, right:8, left:0, fontSize:"0.67rem", color:"var(--muted-2)", textAlign:"right", fontWeight:500 }}>{h}h</div>
            ))}
          </div>
          {days.map((d, di) => {
            const dayItems = forDay(sessions, d);
            const isT      = isSameDay(d, today);
            return (
              <div key={di} onClick={() => onDayClick(d)}
                style={{ borderLeft:"1px solid var(--line-soft)", position:"relative", height:totalH, background:isT?"rgba(201,162,39,0.025)":"transparent", cursor:"pointer" }}
              >
                {hours.map((h) => (
                  <div key={h} style={{ position:"absolute", top:(h-START_H)*ROW_H, left:0, right:0, height:1, borderTop:"1px solid var(--line-soft)" }} />
                ))}
                {dayItems.map((s) => {
                  const dt  = new Date(s.scheduled_at);
                  const top = (dt.getHours() + dt.getMinutes() / 60 - START_H) * ROW_H;
                  const h   = DURATION * ROW_H;
                  if (top < 0 || top > totalH) return null;
                  return (
                    <div key={s.id} onClick={(e) => { e.stopPropagation(); onSessionClick(s); }}
                      style={{ position:"absolute", top, left:4, right:4, height:h, background:BRANCHE_BG[s.branche], border:`1px solid ${BRANCHE_COLOR[s.branche]}40`, borderLeft:`3px solid ${BRANCHE_COLOR[s.branche]}`, borderRadius:6, padding:"5px 8px", overflow:"hidden", cursor:"pointer", zIndex:1, transition:"box-shadow .15s" }}
                      onMouseEnter={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow = `0 3px 14px ${BRANCHE_COLOR[s.branche]}35`; el.style.zIndex="3"; }}
                      onMouseLeave={(e) => { const el = e.currentTarget as HTMLDivElement; el.style.boxShadow=""; el.style.zIndex="1"; }}
                    >
                      <div style={{ fontSize:"0.69rem", fontWeight:700, color:BRANCHE_COLOR[s.branche], marginBottom:2 }}>{fmtT(new Date(s.scheduled_at))}</div>
                      <div style={{ fontSize:"0.78rem", fontWeight:600, color:"var(--cream)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.title}</div>
                      {h > 70 && <div style={{ fontSize:"0.69rem", color:"var(--muted)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{PLATFORM_LABEL[s.platform]}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {inWeek && nowTop >= 0 && nowTop <= totalH && (
            <div style={{ position:"absolute", top:nowTop, left:TIME_W, right:0, height:2, background:"#e05555", zIndex:10, pointerEvents:"none" }}>
              <div style={{ position:"absolute", left:-5, top:-4, width:10, height:10, borderRadius:"50%", background:"#e05555" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vue Agenda ────────────────────────────────────────────────────────────────

function AgendaView({ sessions, onSessionClick, onEdit, onDelete }: {
  sessions: LiveSession[];
  onSessionClick: (s: LiveSession) => void;
  onEdit:   (s: LiveSession) => void;
  onDelete: (id: number) => void;
}) {
  const today = new Date();

  // Grouper par jour (triés chronologiquement)
  const dayMap = new Map<string, LiveSession[]>();
  const sorted = [...sessions].sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  for (const s of sorted) {
    const d = new Date(s.scheduled_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(s);
  }

  if (dayMap.size === 0) {
    return (
      <div style={{ padding:"2.5rem", textAlign:"center", color:"var(--muted)", fontSize:"0.88rem", border:"1px dashed var(--line-soft)", borderRadius:"var(--radius)" }}>
        Aucune session à afficher.
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.5rem" }}>
      {Array.from(dayMap.entries()).map(([key, daySessions]) => {
        const dayDate = new Date(daySessions[0].scheduled_at);
        const isToday = isSameDay(dayDate, today);
        const isPast  = dayDate < today && !isToday;

        return (
          <div key={key}>
            {/* En-tête jour */}
            <div style={{
              display:"flex", alignItems:"center", gap:"0.75rem",
              padding:"0.5rem 0", marginBottom:"0.6rem",
              borderBottom:`2px solid ${isToday ? "var(--gold)" : "var(--line-soft)"}`,
            }}>
              <div style={{
                width:44, height:44, borderRadius:8, flexShrink:0,
                background: isToday ? "var(--gold)" : isPast ? "var(--bg-2)" : "var(--bg-2)",
                border:`1px solid ${isToday ? "var(--gold)" : "var(--line-soft)"}`,
                display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              }}>
                <span style={{ fontSize:"0.58rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:isToday?"#fff":"var(--muted)", lineHeight:1 }}>
                  {DAY_SHORT[(dayDate.getDay()+6)%7]}
                </span>
                <span style={{ fontSize:"1.15rem", fontWeight:800, color:isToday?"#fff":"var(--cream)", lineHeight:1.1 }}>
                  {dayDate.getDate()}
                </span>
              </div>
              <div>
                <div style={{ fontSize:"0.90rem", fontWeight:700, color:isToday?"var(--gold-2)":"var(--cream)" }}>
                  {isToday ? "Aujourd'hui" : fmtDateLong(dayDate)}
                </div>
                <div style={{ fontSize:"0.73rem", color:"var(--muted)" }}>
                  {daySessions.length} session{daySessions.length>1?"s":""}
                  {isToday ? ` — ${MONTH_FR[dayDate.getMonth()]} ${dayDate.getFullYear()}` : ""}
                </div>
              </div>
            </div>

            {/* Sessions du jour */}
            <div style={{ display:"flex", flexDirection:"column", gap:"0.5rem" }}>
              {daySessions.map((s) => {
                const dt = new Date(s.scheduled_at);
                return (
                  <div key={s.id}
                    style={{
                      display:"grid", gridTemplateColumns:"80px 1fr auto",
                      gap:"0.75rem", alignItems:"flex-start",
                      padding:"0.85rem 1rem",
                      background:"var(--bg-1)", borderRadius:"var(--radius)",
                      border:"1px solid var(--line-soft)",
                      borderLeft:`4px solid ${BRANCHE_COLOR[s.branche]}`,
                      opacity: isPast ? 0.65 : 1,
                      transition:"box-shadow .15s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 3px 16px ${BRANCHE_COLOR[s.branche]}18`; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
                  >
                    {/* Heure */}
                    <div style={{ textAlign:"center", paddingTop:"0.1rem" }}>
                      <div style={{ fontSize:"1.25rem", fontWeight:800, color:"var(--cream)", lineHeight:1, fontVariantNumeric:"tabular-nums" }}>
                        {fmtT(dt)}
                      </div>
                      <div style={{ fontSize:"0.67rem", color:"var(--muted)", marginTop:2 }}>
                        {MONTH_FR[dt.getMonth()].slice(0,4).toUpperCase()}
                      </div>
                    </div>

                    {/* Détail */}
                    <div style={{ minWidth:0 }}>
                      <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap", marginBottom:"0.3rem", alignItems:"center" }}>
                        <span style={{ fontSize:"0.94rem", fontWeight:700, color:"var(--cream)" }}>{s.title}</span>
                        {s.status === "EN_COURS" && (
                          <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:"#e05555", fontSize:"0.68rem", fontWeight:700 }}>
                            <span style={{ width:6, height:6, borderRadius:"50%", background:"#e05555", boxShadow:"0 0 6px #e0555599", display:"inline-block" }} />
                            EN DIRECT
                          </span>
                        )}
                      </div>

                      <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap", marginBottom:"0.35rem" }}>
                        <span style={{ fontSize:"0.67rem", fontWeight:700, color:BRANCHE_COLOR[s.branche], background:BRANCHE_BG[s.branche], border:`1px solid ${BRANCHE_COLOR[s.branche]}40`, padding:"0.04rem 0.38rem", borderRadius:99 }}>
                          {BRANCHE_LABEL[s.branche]}
                        </span>
                        <span style={{ fontSize:"0.67rem", fontWeight:600, color:STATUS_COLOR[s.status], background:STATUS_BG[s.status], border:`1px solid ${STATUS_COLOR[s.status]}40`, padding:"0.04rem 0.38rem", borderRadius:99 }}>
                          {STATUS_LABEL[s.status]}
                        </span>
                        <span style={{ fontSize:"0.67rem", fontWeight:600, color:PLATFORM_COLOR[s.platform], background:`${PLATFORM_COLOR[s.platform]}14`, border:`1px solid ${PLATFORM_COLOR[s.platform]}35`, padding:"0.04rem 0.38rem", borderRadius:99 }}>
                          {PLATFORM_LABEL[s.platform]}
                        </span>
                      </div>

                      {s.description && (
                        <p style={{ fontSize:"0.78rem", color:"var(--muted)", lineHeight:1.5, margin:"0 0 0.4rem" }}>
                          {s.description}
                        </p>
                      )}

                      <div style={{ display:"flex", gap:"0.9rem", flexWrap:"wrap" }}>
                        <a href={s.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                          style={{ fontSize:"0.77rem", fontWeight:600, color:PLATFORM_COLOR[s.platform], textDecoration:"none" }}>
                          ↗ Rejoindre
                        </a>
                        {s.replay_url && (
                          <a href={s.replay_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            style={{ fontSize:"0.77rem", fontWeight:600, color:"#b5532a", textDecoration:"none" }}>
                            ▶ Replay
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display:"flex", flexDirection:"column", gap:"0.3rem" }}>
                      <button onClick={() => onEdit(s)}
                        style={{ width:30, height:30, borderRadius:5, background:"var(--bg-2)", color:"var(--muted)", border:"1px solid var(--line-soft)", cursor:"pointer", fontSize:"0.80rem", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        ✎
                      </button>
                      <button onClick={() => onDelete(s.id)}
                        style={{ width:30, height:30, borderRadius:5, background:"rgba(192,64,44,0.07)", color:"#b53a2a", border:"1px solid rgba(192,64,44,0.20)", cursor:"pointer", fontSize:"0.72rem", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Vue Liste ─────────────────────────────────────────────────────────────────

function ListView({ sessions, onSessionClick, onEdit, onDelete }: {
  sessions: LiveSession[];
  onSessionClick: (s: LiveSession) => void;
  onEdit:   (s: LiveSession) => void;
  onDelete: (id: number) => void;
}) {
  const today  = new Date();
  const sorted = [...sessions].sort((a, b) => {
    const da = new Date(a.scheduled_at), db = new Date(b.scheduled_at);
    const futA = da >= today, futB = db >= today;
    if (futA !== futB) return futA ? -1 : 1;
    return futA ? +da - +db : +db - +da;
  });

  if (sorted.length === 0) {
    return (
      <div style={{ padding:"2.5rem", textAlign:"center", color:"var(--muted)", fontSize:"0.88rem", border:"1px dashed var(--line-soft)", borderRadius:"var(--radius)" }}>
        Aucune session à afficher.
      </div>
    );
  }

  return (
    <div style={{ border:"1px solid var(--line-soft)", borderRadius:"var(--radius)", overflow:"hidden" }}>
      {/* Colonnes header */}
      <div style={{
        display:"grid",
        gridTemplateColumns:"160px 1fr 110px 130px 110px 90px",
        gap:"0 0.5rem",
        background:"var(--bg-2)",
        borderBottom:"1px solid var(--line-soft)",
        padding:"0.55rem 1rem",
      }}>
        {["Date & Heure", "Titre", "Branche", "Plateforme", "Statut", "Actions"].map((h) => (
          <span key={h} style={{ fontSize:"0.69rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--muted)" }}>{h}</span>
        ))}
      </div>

      {/* Lignes */}
      {sorted.map((s, idx) => {
        const dt     = new Date(s.scheduled_at);
        const isPast = dt < today;
        return (
          <div key={s.id}
            style={{
              display:"grid",
              gridTemplateColumns:"160px 1fr 110px 130px 110px 90px",
              gap:"0 0.5rem",
              alignItems:"center",
              padding:"0.65rem 1rem",
              background: idx % 2 === 0 ? "var(--bg-1)" : "var(--bg-2)",
              borderBottom: idx < sorted.length - 1 ? "1px solid var(--line-soft)" : "none",
              opacity: isPast ? 0.62 : 1,
              transition:"background .12s",
              cursor:"pointer",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = `${BRANCHE_COLOR[s.branche]}0e`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = idx % 2 === 0 ? "var(--bg-1)" : "var(--bg-2)"; }}
            onClick={() => onSessionClick(s)}
          >
            {/* Date */}
            <div>
              <div style={{ fontSize:"0.80rem", fontWeight:700, color:"var(--cream)", fontVariantNumeric:"tabular-nums" }}>
                {fmtDateShort(dt)}
              </div>
              <div style={{ fontSize:"0.73rem", color:"var(--muted-2)", fontVariantNumeric:"tabular-nums" }}>
                {fmtT(dt)}
              </div>
            </div>

            {/* Titre */}
            <div style={{ overflow:"hidden" }}>
              <div style={{ fontSize:"0.84rem", fontWeight:600, color:"var(--cream)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {s.title}
              </div>
              {s.replay_url && (
                <span style={{ fontSize:"0.63rem", color:"#b5532a", fontWeight:600 }}>▶ Replay dispo</span>
              )}
            </div>

            {/* Branche */}
            <span style={{ fontSize:"0.67rem", fontWeight:700, color:BRANCHE_COLOR[s.branche], background:BRANCHE_BG[s.branche], border:`1px solid ${BRANCHE_COLOR[s.branche]}40`, padding:"0.06rem 0.42rem", borderRadius:99, justifySelf:"start" }}>
              {BRANCHE_LABEL[s.branche]}
            </span>

            {/* Plateforme */}
            <span style={{ fontSize:"0.70rem", fontWeight:600, color:PLATFORM_COLOR[s.platform], background:`${PLATFORM_COLOR[s.platform]}12`, border:`1px solid ${PLATFORM_COLOR[s.platform]}30`, padding:"0.06rem 0.42rem", borderRadius:99, justifySelf:"start" }}>
              {PLATFORM_LABEL[s.platform]}
            </span>

            {/* Statut */}
            <div style={{ display:"flex", alignItems:"center", gap:4, justifySelf:"start" }}>
              {s.status === "EN_COURS" && (
                <span style={{ width:6, height:6, borderRadius:"50%", background:"#e05555", boxShadow:"0 0 5px #e0555599", display:"inline-block", flexShrink:0 }} />
              )}
              <span style={{ fontSize:"0.67rem", fontWeight:700, color:STATUS_COLOR[s.status], background:STATUS_BG[s.status], border:`1px solid ${STATUS_COLOR[s.status]}40`, padding:"0.06rem 0.42rem", borderRadius:99 }}>
                {STATUS_LABEL[s.status]}
              </span>
            </div>

            {/* Actions */}
            <div style={{ display:"flex", gap:"0.3rem", justifySelf:"start" }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onEdit(s)}
                style={{ width:28, height:28, borderRadius:5, background:"var(--bg-2)", color:"var(--muted)", border:"1px solid var(--line-soft)", cursor:"pointer", fontSize:"0.80rem", display:"flex", alignItems:"center", justifyContent:"center" }}>
                ✎
              </button>
              <button onClick={() => onDelete(s.id)}
                style={{ width:28, height:28, borderRadius:5, background:"rgba(192,64,44,0.07)", color:"#b53a2a", border:"1px solid rgba(192,64,44,0.20)", cursor:"pointer", fontSize:"0.72rem", display:"flex", alignItems:"center", justifyContent:"center" }}>
                🗑
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Modal détail session ──────────────────────────────────────────────────────

function SessionDetailModal({ session: s, onClose, onEdit, onDelete }: {
  session: LiveSession; onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <Modal title={s.title} onClose={onClose} maxWidth={500}>
      <div style={{ display:"flex", flexDirection:"column", gap:"0.85rem" }}>
        <div style={{ display:"flex", gap:"0.45rem", flexWrap:"wrap", alignItems:"center" }}>
          {[
            { color: BRANCHE_COLOR[s.branche], bg: BRANCHE_BG[s.branche], label: BRANCHE_LABEL[s.branche] },
            { color: STATUS_COLOR[s.status],  bg: STATUS_BG[s.status],   label: STATUS_LABEL[s.status] },
            { color: PLATFORM_COLOR[s.platform], bg: `${PLATFORM_COLOR[s.platform]}14`, label: PLATFORM_LABEL[s.platform] },
          ].map(({ color, bg, label }) => (
            <span key={label} style={{ background:bg, color, border:`1px solid ${color}44`, fontSize:"0.74rem", fontWeight:600, padding:"0.18rem 0.65rem", borderRadius:99 }}>{label}</span>
          ))}
          {s.status === "EN_COURS" && (
            <span style={{ display:"inline-flex", alignItems:"center", gap:5, color:"#e05555", fontSize:"0.74rem", fontWeight:700 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#e05555", boxShadow:"0 0 8px #e0555599", display:"inline-block" }} />
              EN DIRECT
            </span>
          )}
        </div>
        <div style={{ background:"var(--bg-2)", borderRadius:"var(--radius-sm)", padding:"0.7rem 0.9rem", fontSize:"0.85rem", color:"var(--cream)", fontWeight:500 }}>
          🕐 {new Date(s.scheduled_at).toLocaleString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })}
        </div>
        {s.description && <p style={{ fontSize:"0.84rem", color:"var(--muted)", lineHeight:1.58, margin:0 }}>{s.description}</p>}
        <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap" }}>
          <a href={s.link} target="_blank" rel="noreferrer" style={{ color:PLATFORM_COLOR[s.platform], fontSize:"0.84rem", fontWeight:600, textDecoration:"none" }}>↗ Rejoindre la session</a>
          {s.replay_url && <a href={s.replay_url} target="_blank" rel="noreferrer" style={{ color:"#b5532a", fontSize:"0.84rem", fontWeight:600, textDecoration:"none" }}>▶ Voir le replay</a>}
        </div>
        <div style={{ display:"flex", gap:"0.5rem", justifyContent:"flex-end", paddingTop:"0.75rem", borderTop:"1px solid var(--line-soft)" }}>
          <Button variant="danger" onClick={onDelete}>Supprimer</Button>
          <Button onClick={onEdit}>Modifier</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function LivesPage() {
  const { toast } = useToast();
  const [items,   setItems]   = useState<LiveSession[]>([]);
  const [view,    setView]    = useState<LiveView>(() =>
    (typeof window !== "undefined" ? (localStorage.getItem("lives_view") as LiveView) : null) ?? "month"
  );
  const [current, setCurrent] = useState(new Date());

  // Filtres
  const [search,        setSearch]        = useState("");
  const [filterBranche, setFilterBranche] = useState("ALL");
  const [filterStatus,  setFilterStatus]  = useState("ALL");
  const [filterPlatform,setFilterPlatform]= useState("ALL");

  const [formTarget,   setFormTarget]   = useState<{ session: LiveSession | null; date?: Date } | null>(null);
  const [detailTarget, setDetailTarget] = useState<LiveSession | null>(null);
  const [deleteId,     setDeleteId]     = useState<number | null>(null);

  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await livesApi.list();
      setItems(Array.isArray(data) ? data : (data as Paginated<LiveSession>).results);
    } catch {
      toast("Impossible de charger les sessions. Vérifiez votre connexion.", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const changeView = (v: LiveView) => {
    setView(v);
    localStorage.setItem("lives_view", v);
  };

  const navigate = (dir: -1 | 1) => {
    const d = new Date(current);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * 7);
    setCurrent(d);
  };

  const headerTitle = view === "month"
    ? `${MONTH_FR[current.getMonth()]} ${current.getFullYear()}`
    : (() => {
        const w = getWeekDays(current);
        return `${w[0].getDate()} – ${w[6].getDate()} ${MONTH_FR[current.getMonth()]} ${current.getFullYear()}`;
      })();

  // Filtrer
  const filtered = items.filter((s) =>
    (filterBranche  === "ALL" || s.branche  === filterBranche) &&
    (filterStatus   === "ALL" || s.status   === filterStatus) &&
    (filterPlatform === "ALL" || s.platform === filterPlatform) &&
    (!search || s.title.toLowerCase().includes(search.toLowerCase()) ||
     s.description.toLowerCase().includes(search.toLowerCase()))
  );

  // KPIs
  const now      = new Date();
  const upcoming = items.filter((s) => s.status === "PLANIFIE" && new Date(s.scheduled_at) >= now);
  const live     = items.filter((s) => s.status === "EN_COURS");
  const past     = items.filter((s) => s.status === "TERMINE");

  const calView = view === "month" || view === "week";

  return (
    <div className="fade-up">

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"1.25rem", gap:"1rem", flexWrap:"wrap" }}>
        <div>
          <div className="eyebrow">Communauté</div>
          <h1 style={{ marginBottom:"0.35rem" }}>Sessions en direct</h1>
          {/* KPIs */}
          <div style={{ display:"flex", gap:"0.65rem", flexWrap:"wrap" }}>
            {[
              { label: "Total",     val: items.length,    color: "var(--muted)" },
              { label: "À venir",   val: upcoming.length, color: "#c9a227"      },
              { label: "En direct", val: live.length,     color: "#e05555"      },
              { label: "Terminés",  val: past.length,     color: "var(--muted-2)" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ display:"flex", alignItems:"center", gap:"0.32rem" }}>
                {label === "En direct" && val > 0 && (
                  <span style={{ width:6, height:6, borderRadius:"50%", background:"#e05555", boxShadow:"0 0 5px #e0555580", flexShrink:0 }} />
                )}
                <span style={{ fontSize:"0.78rem", fontWeight:700, color, fontVariantNumeric:"tabular-nums" }}>{val}</span>
                <span style={{ fontSize:"0.78rem", color:"var(--muted-2)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <Button onClick={() => setFormTarget({ session:null })}>+ Nouveau live</Button>
      </div>

      {/* ── Barre de contrôle ── */}
      <div style={{ display:"flex", alignItems:"flex-end", gap:"0.65rem", marginBottom:"1rem", flexWrap:"wrap" }}>

        {/* Recherche */}
        <div style={{ flex:1, minWidth:160 }}>
          <Input label="" value={search} placeholder="Rechercher une session…"
            onChange={(e) => setSearch(e.target.value)} />
        </div>

        {/* Filtres */}
        <div style={{ width:130 }}>
          <Select label="" value={filterBranche} onChange={(e) => setFilterBranche(e.target.value)}>
            <option value="ALL">Toutes les branches</option>
            <option value="MEMBRE">Générale</option>
            <option value="FEMME">Femmes</option>
            <option value="ENFANT">Enfants</option>
          </Select>
        </div>
        <div style={{ width:120 }}>
          <Select label="" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="ALL">Tous statuts</option>
            <option value="PLANIFIE">Planifié</option>
            <option value="EN_COURS">En cours</option>
            <option value="TERMINE">Terminé</option>
          </Select>
        </div>
        <div style={{ width:130 }}>
          <Select label="" value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
            <option value="ALL">Toutes plateformes</option>
            <option value="ZOOM">Zoom</option>
            <option value="YOUTUBE">YouTube</option>
            <option value="MEET">Meet</option>
            <option value="TEAMS">Teams</option>
          </Select>
        </div>

        {/* Toggle vue */}
        <div style={{ display:"flex", gap:0, border:"1px solid var(--line-soft)", borderRadius:6, overflow:"hidden", flexShrink:0 }}>
          {LIVE_VIEWS.map((v) => (
            <button key={v.key} title={v.label} onClick={() => changeView(v.key)}
              style={{
                width:34, height:34, border:"none", cursor:"pointer",
                fontSize:"0.95rem", lineHeight:1,
                background: view === v.key ? "var(--gold)" : "transparent",
                color: view === v.key ? "#fff" : "var(--muted)",
                transition:"background .14s, color .14s",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
              {v.icon}
            </button>
          ))}
        </div>

        {/* Navigation mois/semaine — masquée pour agenda/liste */}
        {calView && (
          <div style={{ display:"flex", alignItems:"center", gap:"0.35rem", flexShrink:0 }}>
            <button onClick={() => navigate(-1)} style={{ background:"var(--bg-1)", border:"1px solid var(--line-soft)", borderRadius:"var(--radius-sm)", width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"var(--cream)", fontSize:"1.1rem" }}>‹</button>
            <button onClick={() => setCurrent(new Date())} style={{ background:"var(--bg-1)", border:"1px solid var(--line-soft)", borderRadius:"var(--radius-sm)", padding:"0 0.75rem", height:32, cursor:"pointer", color:"var(--cream)", fontSize:"0.80rem", fontWeight:600, whiteSpace:"nowrap" }}>Aujourd&apos;hui</button>
            <button onClick={() => navigate(1)} style={{ background:"var(--bg-1)", border:"1px solid var(--line-soft)", borderRadius:"var(--radius-sm)", width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"var(--cream)", fontSize:"1.1rem" }}>›</button>
            <span style={{ fontSize:"0.90rem", fontWeight:700, color:"var(--cream)", marginLeft:"0.2rem", whiteSpace:"nowrap" }}>{headerTitle}</span>
          </div>
        )}
      </div>

      {/* ── Légende branches (calendriers seulement) ── */}
      {calView && (
        <div style={{ display:"flex", gap:"0.75rem", marginBottom:"0.75rem" }}>
          {(["MEMBRE","FEMME","ENFANT"] as Branche[]).map((b) => (
            <span key={b} style={{ display:"flex", alignItems:"center", gap:5, fontSize:"0.73rem", color:"var(--muted)" }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:BRANCHE_COLOR[b], display:"inline-block" }} />
              {BRANCHE_LABEL[b]}
            </span>
          ))}
        </div>
      )}

      {/* ── Vue ── */}
      {view === "month" && (
        <MonthView date={current} sessions={filtered}
          onDayClick={(d) => setFormTarget({ session:null, date:d })}
          onSessionClick={setDetailTarget} />
      )}
      {view === "week" && (
        <WeekView date={current} sessions={filtered}
          onDayClick={(d) => setFormTarget({ session:null, date:d })}
          onSessionClick={setDetailTarget} />
      )}
      {view === "agenda" && (
        <AgendaView sessions={filtered}
          onSessionClick={setDetailTarget}
          onEdit={(s) => setFormTarget({ session:s })}
          onDelete={(id) => setDeleteId(id)} />
      )}
      {view === "liste" && (
        <ListView sessions={filtered}
          onSessionClick={setDetailTarget}
          onEdit={(s) => setFormTarget({ session:s })}
          onDelete={(id) => setDeleteId(id)} />
      )}

      {/* ── Modals ── */}
      {detailTarget && (
        <SessionDetailModal
          session={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => { setFormTarget({ session:detailTarget }); setDetailTarget(null); }}
          onDelete={() => { setDeleteId(detailTarget.id); setDetailTarget(null); }}
        />
      )}
      {formTarget && (
        <LiveFormModal
          initial={
            formTarget.session ? {
              title:        formTarget.session.title,
              description:  formTarget.session.description,
              scheduled_at: formTarget.session.scheduled_at.slice(0, 16),
              status:       formTarget.session.status,
              platform:     formTarget.session.platform,
              link:         formTarget.session.link,
              branche:      formTarget.session.branche,
              replay_url:   formTarget.session.replay_url ?? "",
            } : {
              ...EMPTY,
              scheduled_at: formTarget.date
                ? (() => { const d = new Date(formTarget.date); d.setHours(10,0,0,0); return d.toISOString().slice(0,16); })()
                : "",
            }
          }
          editing={formTarget.session?.id ?? null}
          onClose={() => setFormTarget(null)}
          onSaved={(msg) => { toast(msg, "success"); setFormTarget(null); load(); }}
        />
      )}
      {deleteId !== null && (
        <ConfirmModal
          title="Supprimer la session"
          message="Cette action est irréversible. La session sera définitivement supprimée."
          confirmLabel="Supprimer"
          onClose={() => setDeleteId(null)}
          onConfirm={async () => {
            await livesApi.remove(deleteId);
            toast("Session supprimée.", "success");
            setDeleteId(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
