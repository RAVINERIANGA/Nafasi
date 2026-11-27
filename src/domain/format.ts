export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function etaMinutes(km: number) {
  return Math.max(8, Math.round((km / 35) * 60 + 4));
}

export function formatKm(km: number) {
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatDuration(seconds?: number | null) {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${seconds} sec`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export function formatClock(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ageLabel(age: number, unit: "years" | "months") {
  if (unit === "months") return `${age} ${age === 1 ? "month" : "months"}`;
  return `${age} ${age === 1 ? "year" : "years"}`;
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ••• ${digits.slice(-3)}`;
}

export function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function minutesBetween(a?: string, b?: string) {
  if (!a || !b) return undefined;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
}

export function vitalLine(v?: {
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  spo2?: number;
  avpu?: string;
}) {
  if (!v) return "No vitals yet";
  const parts: string[] = [];
  if (v.systolic && v.diastolic) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.pulse) parts.push(`Pulse ${v.pulse}`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.avpu) parts.push(`AVPU ${v.avpu}`);
  return parts.join(" · ") || "Vitals recorded";
}
