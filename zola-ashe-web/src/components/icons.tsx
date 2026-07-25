/** Icônes minimalistes (stroke) pour la navigation mobile. */
type P = { className?: string };
const base = {
  width: 24, height: 24,
  fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function IconHome({ className = "nav-ico" }: P) {
  return (<svg {...base} className={className}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>);
}
export function IconLibrary({ className = "nav-ico" }: P) {
  return (<svg {...base} className={className}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18" /><path d="M12 7h4M12 11h4" /></svg>);
}
export function IconCommunity({ className = "nav-ico" }: P) {
  return (<svg {...base} className={className}><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z" /></svg>);
}
export function IconUser({ className = "nav-ico" }: P) {
  return (<svg {...base} className={className}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
}
export function IconPlay({ className = "" }: P) {
  return (<svg {...base} className={className} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>);
}
export function IconLock({ className = "" }: P) {
  return (<svg {...base} className={className}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>);
}
export function IconCheck({ className = "" }: P) {
  return (<svg {...base} className={className}><path d="M5 12.5l4.5 4.5L19 7" /></svg>);
}
export function IconHeart({ className = "", filled = false }: P & { filled?: boolean }) {
  return (<svg {...base} className={className} fill={filled ? "currentColor" : "none"}>
    <path d="M20.8 7.6a5 5 0 0 0-8.8-2.1A5 5 0 0 0 3.2 7.6c0 4 4.5 7 8.8 10.9 4.3-3.9 8.8-6.9 8.8-10.9z" /></svg>);
}
export function IconComment({ className = "" }: P) {
  return (<svg {...base} className={className}><path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.4A8 8 0 1 1 21 11.5z" /></svg>);
}
export function IconDoc({ className = "" }: P) {
  return (<svg {...base} className={className}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>);
}
export function IconAudio({ className = "" }: P) {
  return (<svg {...base} className={className}><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></svg>);
}
