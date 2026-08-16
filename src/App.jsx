import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Home, Users, Plus, Settings as SettingsIcon, Search, Phone, MessageCircle,
  Pencil, Trash2, X, ArrowLeft, Download, Lock, Eye, EyeOff, ChevronRight,
  Check, FileText, Calendar, Glasses, AlertTriangle, User, Receipt, Copy,
  Star, Printer, Link2, LogOut, Mail, Gift, Send, RotateCcw, Image as ImageIcon, Share2, Briefcase
} from "lucide-react";
import { supabase } from "./supabase";

/* ---------- fonts + tokens ---------- */
const FontLoader = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .ks-root { font-family: 'Inter', sans-serif; }
    .ks-display { font-family: 'Fraunces', serif; }
    .ks-mono { font-family: 'IBM Plex Mono', monospace; }
    .ks-scrollbar::-webkit-scrollbar { width: 4px; height:4px; }
    .ks-scrollbar::-webkit-scrollbar-thumb { background: #E6E3DC; border-radius: 4px; }
    input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.55; }
    @keyframes ks-rise { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform: translateY(0);} }
    .ks-rise { animation: ks-rise 0.28s ease both; }
    @keyframes ks-toast { 0%{opacity:0; transform: translate(-50%,8px);} 10%{opacity:1; transform: translate(-50%,0);} 90%{opacity:1; transform: translate(-50%,0);} 100%{opacity:0; transform: translate(-50%,8px);} }
    .ks-toast { animation: ks-toast 2.4s ease forwards; }
    @media print {
      .no-print { display: none !important; }
      .ks-bill-print { box-shadow: none !important; border: none !important; }
      body { background: #fff !important; }
    }
  `}</style>
);

const COLORS = {
  ink: "#101010",
  paper: "#FFFFFF",
  cream: "#FAF9F6",
  line: "#E6E3DC",
  brass: "#9C7C4E",
  brassLight: "#C9A876",
  muted: "#726F68",
  danger: "#AE3B2E",
};

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return d; }
};

const digitsOnly = (s) => (s || "").replace(/\D/g, "");

/* ---- mobile: always store/display with +91 country code ---- */
const MOBILE_CC = "+91";
function normalizeMobile(raw) {
  let d = digitsOnly(raw);
  if (d.startsWith("91") && d.length > 10) d = d.slice(2);
  d = d.slice(0, 10);
  return d;
}
function formatMobileFull(tenDigits) {
  const d = normalizeMobile(tenDigits);
  return d ? `${MOBILE_CC} ${d}` : "";
}
function mobileDialDigits(mobile) {
  // returns digits with country code, no plus, for tel:/wa.me links
  let d = digitsOnly(mobile);
  if (!d.startsWith("91")) d = "91" + d;
  return d;
}
function waLink(mobile, text) {
  const t = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${mobileDialDigits(mobile)}${t}`;
}
function waBusinessLink(mobile, text) {
  const t = text ? `&text=${encodeURIComponent(text)}` : "";
  // Android intent URL that targets the WhatsApp Business app specifically,
  // instead of leaving the choice to whatever handles wa.me links.
  return `intent://send?phone=${mobileDialDigits(mobile)}${t}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end`;
}

/* ---------- Supabase data layer ---------- */
function rowToCustomer(row) {
  return { id: row.id, name: row.name, mobile: row.mobile, dob: row.dob || "", createdAt: row.created_at, records: row.records || [] };
}
function customerToRow(customer) {
  return { id: customer.id, name: customer.name, mobile: customer.mobile, dob: customer.dob || "", created_at: customer.createdAt, records: customer.records || [] };
}

async function fetchCustomers() {
  const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return (data || []).map(rowToCustomer);
}
async function saveCustomerRow(customer) {
  const { error } = await supabase.from("customers").upsert(customerToRow(customer));
  if (error) console.error(error);
}
async function deleteCustomerRow(id) {
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) console.error(error);
}
async function savePublicBillRow(token, data) {
  const { error } = await supabase.from("bills").upsert({ token, data });
  if (error) console.error(error);
}
async function fetchPublicBill(token) {
  // Goes through a SECURITY DEFINER function so a customer can fetch exactly one
  // bill by its exact token, without ever being able to list/browse the table.
  const { data, error } = await supabase.rpc("get_public_bill", { p_token: token });
  if (error) { console.error(error); return null; }
  return data || null;
}

/* Atomic per-year bill id counter, e.g. KS-2026-00125 (runs as a Postgres RPC) */
async function nextBillId() {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.rpc("next_bill_number", { p_year: year });
  if (error) { console.error(error); throw error; }
  return `KS-${year}-${String(data).padStart(5, "0")}`;
}
function genToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 22);
  return Array.from({ length: 22 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
}
function billLinkFor(token) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://yourdomain.com";
  return `${origin}/bill/${token}`;
}

/* ---------- Offers / WhatsApp broadcast cycling ---------- */
const OFFER_ID = "current";
async function fetchOffer() {
  const { data, error } = await supabase.from("offers").select("*").eq("id", OFFER_ID).maybeSingle();
  if (error) { console.error(error); return null; }
  return data || null;
}
async function saveOfferRow(offer) {
  const { error } = await supabase.from("offers").upsert({ id: OFFER_ID, ...offer });
  if (error) console.error(error);
}
async function uploadOfferImage(file) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `offer-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("offer-images").upload(path, file, { upsert: true });
  if (error) { console.error(error); return null; }
  const { data } = supabase.storage.from("offer-images").getPublicUrl(path);
  return data?.publicUrl || null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysSince(dateStr) {
  const start = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const diff = Math.floor((now - start) / 86400000);
  return Math.max(0, diff);
}
/* Figures out which slice of customers ("today's batch") this offer should reach today,
   cycling back to the start once every customer has had a turn. */
function computeBatch(offer, customers) {
  const sorted = [...customers].sort((a, b) => a.createdAt - b.createdAt);
  const total = sorted.length;
  const batchSize = offer?.batch_size || 30;
  const totalBatches = Math.max(1, Math.ceil(total / batchSize) || 1);
  const dayIdx = offer ? daysSince(offer.cycle_start_date) : 0;
  const batchIndex = total > 0 ? dayIdx % totalBatches : 0;
  const start = batchIndex * batchSize;
  const list = sorted.slice(start, start + batchSize);
  return { batchIndex, totalBatches, list, dayIdx, total, batchSize };
}
function offerWaMessage(offer, customerName) {
  return `Hello ${customerName} 👋

🎉 Special Offer from K.S OPTICALS!

${offer.title}
${offer.description}

Visit us soon and grab this offer!

K.S OPTICALS
${SHOP_ADDRESS}
📞 ${SHOP_PHONE}`;
}

const PAY_STATUS = {
  Paid: { color: "#2E8B4F", bg: "#E9F5EC", icon: "✅" },
  Partial: { color: "#B8860B", bg: "#FBF3DD", icon: "🟡" },
  Pending: { color: "#AE3B2E", bg: "#FBEAE8", icon: "🔴" },
};

const money = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? "0" : n.toLocaleString("en-IN");
};

const powerStr = (v) => {
  if (v === "" || v === undefined || v === null) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return (n > 0 ? "+" : "") + n.toFixed(2);
};

function latestRecord(customer) {
  if (!customer.records || customer.records.length === 0) return null;
  return [...customer.records].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || "") || b.createdAt - a.createdAt)[0];
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(customers) {
  const headers = [
    "Bill ID", "Customer Name", "Mobile", "DOB", "OD SPH", "OD CYL", "OD Axis",
    "OS SPH", "OS CYL", "OS Axis", "ADD", "Frame Details", "Lens Details", "Coating",
    "Product/Lens/Frame Details", "Order Date", "Delivery Date", "Bill Date",
    "Total Price", "Discount", "Final Amount", "Payment Status", "Notes"
  ];
  const rows = [headers];
  customers.forEach((c) => {
    (c.records || []).forEach((r) => {
      const finalAmt = (parseFloat(r.totalPrice) || 0) - (parseFloat(r.discount) || 0);
      rows.push([
        r.billId || "", c.name, c.mobile, c.dob || "", r.odSph, r.odCyl, r.odAxis,
        r.osSph, r.osCyl, r.osAxis, r.add, r.frameDetails, r.lensDetails, r.coating,
        r.product, fmtDate(r.orderDate), fmtDate(r.deliveryDate), fmtDate(r.billDate),
        r.totalPrice, r.discount, r.totalPrice || r.discount ? finalAmt : "", r.paymentStatus, r.notes
      ]);
    });
    if (!c.records || c.records.length === 0) {
      rows.push([c.name, c.mobile, c.dob || "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
    }
  });
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

/* (Firestore data layer defined above replaces the old window.storage persistence) */

/* ---------- small UI atoms ---------- */
const Toast = ({ text, onDone }) => {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="ks-toast fixed bottom-24 md:bottom-8 left-1/2 z-50 px-5 py-3 rounded-full shadow-lg flex items-center gap-2"
      style={{ background: COLORS.ink, color: COLORS.paper }}>
      <Check size={15} style={{ color: COLORS.brassLight }} />
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
};

const Field = ({ label, children, required, hint }) => (
  <label className="block mb-4">
    <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: COLORS.muted }}>
      {label} {required && <span style={{ color: COLORS.brass }}>*</span>}
    </span>
    <div className="mt-1.5">{children}</div>
    {hint && <span className="text-[11px] mt-1 block" style={{ color: COLORS.muted }}>{hint}</span>}
  </label>
);

const inputBase = "w-full px-3.5 py-2.5 rounded-lg text-[15px] outline-none transition-all bg-white";
const inputStyle = { border: `1px solid ${COLORS.line}`, color: COLORS.ink };

const TextInput = (props) => (
  <input {...props} className={inputBase + " " + (props.className || "")} style={{ ...inputStyle, ...(props.style || {}) }}
    onFocus={(e) => { e.target.style.borderColor = COLORS.brass; props.onFocus?.(e); }}
    onBlur={(e) => { e.target.style.borderColor = COLORS.line; props.onBlur?.(e); }} />
);

const TextArea = (props) => (
  <textarea {...props} className={inputBase + " resize-none " + (props.className || "")} style={{ ...inputStyle, ...(props.style || {}) }}
    onFocus={(e) => { e.target.style.borderColor = COLORS.brass; props.onFocus?.(e); }}
    onBlur={(e) => { e.target.style.borderColor = COLORS.line; props.onBlur?.(e); }} />
);

const MobileInput = ({ value, onChange, autoFocus }) => (
  <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
    <div className="flex items-center px-3 text-[15px] font-semibold ks-mono" style={{ background: COLORS.cream, color: COLORS.ink }}>
      {MOBILE_CC}
    </div>
    <input
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(normalizeMobile(e.target.value))}
      inputMode="numeric"
      maxLength={10}
      placeholder="98765 43210"
      className="flex-1 px-3.5 py-2.5 text-[15px] outline-none bg-white"
      style={{ color: COLORS.ink }}
      onFocus={(e) => { e.target.parentElement.style.borderColor = COLORS.brass; }}
      onBlur={(e) => { e.target.parentElement.style.borderColor = COLORS.line; }}
    />
  </div>
);

const PrimaryBtn = ({ children, className = "", ...props }) => (
  <button {...props} className={"px-5 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-transform active:scale-[0.98] " + className}
    style={{ background: COLORS.ink, color: COLORS.paper }}>
    {children}
  </button>
);

const GhostBtn = ({ children, className = "", ...props }) => (
  <button {...props} className={"px-4 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors " + className}
    style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink, background: "transparent" }}>
    {children}
  </button>
);

const SectionCard = ({ children, className = "" }) => (
  <div className={"rounded-2xl p-5 " + className} style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}>
    {children}
  </div>
);

/* Confirm modal */
const ConfirmDialog = ({ open, title, body, onCancel, onConfirm, confirmLabel = "Delete" }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4" style={{ background: "rgba(16,16,16,0.5)" }}>
      <div className="ks-rise w-full md:max-w-sm rounded-t-2xl md:rounded-2xl p-6" style={{ background: COLORS.paper }}>
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} style={{ color: COLORS.danger }} />
          <h3 className="ks-display text-lg font-semibold" style={{ color: COLORS.ink }}>{title}</h3>
        </div>
        <p className="text-sm mb-6" style={{ color: COLORS.muted }}>{body}</p>
        <div className="flex gap-3">
          <GhostBtn className="flex-1" onClick={onCancel}>Cancel</GhostBtn>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: COLORS.danger }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Prescription grid (signature element) ---------- */
const PowerGrid = ({ record, compact }) => {
  const Cell = ({ label, value }) => (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: COLORS.muted }}>{label}</div>
      <div className="ks-mono font-medium" style={{ fontSize: compact ? 13 : 15, color: COLORS.ink }}>{powerStr(value)}</div>
    </div>
  );
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
      <div className="grid grid-cols-4" style={{ background: COLORS.cream }}>
        <div className="py-1.5 px-2 text-[9px] font-bold uppercase tracking-widest flex items-center" style={{ color: COLORS.brass }}>Eye</div>
        <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-widest" style={{ color: COLORS.brass }}>Sph</div>
        <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-widest" style={{ color: COLORS.brass }}>Cyl</div>
        <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-widest" style={{ color: COLORS.brass }}>Axis</div>
      </div>
      <div className="grid grid-cols-4 items-center border-t" style={{ borderColor: COLORS.line }}>
        <div className="py-2 px-2 text-xs font-semibold" style={{ color: COLORS.ink }}>OD <span style={{ color: COLORS.muted, fontWeight: 400 }}>(R)</span></div>
        <Cell label="" value={record.odSph} /><Cell label="" value={record.odCyl} /><Cell label="" value={record.odAxis} />
      </div>
      <div className="grid grid-cols-4 items-center border-t" style={{ borderColor: COLORS.line }}>
        <div className="py-2 px-2 text-xs font-semibold" style={{ color: COLORS.ink }}>OS <span style={{ color: COLORS.muted, fontWeight: 400 }}>(L)</span></div>
        <Cell label="" value={record.osSph} /><Cell label="" value={record.osCyl} /><Cell label="" value={record.osAxis} />
      </div>
      {record.add ? (
        <div className="flex items-center justify-between px-3 py-1.5 border-t text-[11px]" style={{ borderColor: COLORS.line, color: COLORS.muted }}>
          <span className="uppercase tracking-widest font-semibold" style={{ color: COLORS.brass }}>Add</span>
          <span className="ks-mono" style={{ color: COLORS.ink }}>{record.add}</span>
        </div>
      ) : null}
    </div>
  );
};

/* ---------- Logo ---------- */
const Logo = ({ size = "md" }) => (
  <div className="flex items-center gap-2.5">
    <div className="flex items-center justify-center rounded-full" style={{
      width: size === "lg" ? 46 : 34, height: size === "lg" ? 46 : 34, border: `1.5px solid ${COLORS.brass}`
    }}>
      <Glasses size={size === "lg" ? 22 : 16} style={{ color: COLORS.brass }} />
    </div>
    <div>
      <div className="ks-display leading-none font-semibold tracking-tight" style={{ fontSize: size === "lg" ? 22 : 16, color: COLORS.ink }}>K.S OPTICALS</div>
      {size === "lg" && <div className="text-[10px] uppercase tracking-[0.2em] mt-0.5" style={{ color: COLORS.muted }}>Customer Records</div>}
    </div>
  </div>
);

/* ================= MAIN APP ================= */
const BootScreen = () => (
  <div className="ks-root min-h-screen flex flex-col items-center justify-center" style={{ background: "#0A0A0A" }}>
    <FontLoader />
    <div className="flex items-center justify-center rounded-full mb-3" style={{ width: 76, height: 76, border: `2px solid ${COLORS.brass}` }}>
      <span className="ks-display font-bold" style={{ fontSize: 30, color: COLORS.brassLight }}>KS</span>
    </div>
    <div className="ks-display text-xl font-semibold" style={{ color: "#F2EFE9" }}>K.S OPTICALS</div>
    <div className="flex items-center gap-2 mt-4">
      <span style={{ width: 24, height: 1, background: COLORS.brass, opacity: 0.6 }} />
      <span className="text-[13px]" style={{ color: COLORS.brassLight, fontFamily: "'Fraunces', serif" }}>Powered by Fardeen Royal</span>
      <span style={{ width: 24, height: 1, background: COLORS.brass, opacity: 0.6 }} />
    </div>
  </div>
);

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [dataReady, setDataReady] = useState(false);
  const [view, setView] = useState("dashboard");
  const [activeId, setActiveId] = useState(null);
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [billCtx, setBillCtx] = useState(null);
  const [offer, setOffer] = useState(null);

  // Public /bill/:token route — works with no login, for customers
  const publicToken = useMemo(() => {
    const m = window.location.pathname.match(/^\/bill\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user || null); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setCustomers([]); setDataReady(false); return; }
    (async () => {
      const [list, off] = await Promise.all([fetchCustomers(), fetchOffer()]);
      setCustomers(list);
      setOffer(off);
      setDataReady(true);
    })();
  }, [user]);

  const showToast = (t) => setToast(t);

  const active = useMemo(() => customers.find((c) => c.id === activeId) || null, [customers, activeId]);

  const totalRecords = useMemo(() => customers.reduce((n, c) => n + (c.records?.length || 0), 0), [customers]);
  const batchInfo = useMemo(() => computeBatch(offer, customers), [offer, customers]);

  const saveOffer = async (form, { resetCycle }) => {
    const next = {
      title: form.title.trim(),
      description: form.description.trim(),
      batch_size: form.batchSize || 30,
      image_url: form.imageUrl || null,
      cycle_start_date: resetCycle ? todayStr() : (offer?.cycle_start_date || todayStr()),
      updated_at: Date.now(),
    };
    await saveOfferRow(next);
    setOffer(next);
    showToast(resetCycle ? "Offer saved · cycle restarted from Day 1" : "Offer updated");
    setView("offers");
  };

  const resetCycle = async () => {
    if (!offer) return;
    const next = { ...offer, cycle_start_date: todayStr(), updated_at: Date.now() };
    await saveOfferRow(next);
    setOffer(next);
    showToast("Cycle restarted from Day 1");
  };


  const recentCustomers = useMemo(
    () => [...customers].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [customers]
  );
  const recentRecords = useMemo(() => {
    const all = [];
    customers.forEach((c) => (c.records || []).forEach((r) => all.push({ ...r, customerName: c.name, customerId: c.id })));
    return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  }, [customers]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [...customers].sort((a, b) => b.createdAt - a.createdAt);
    return customers.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (digitsOnly(c.mobile).includes(digitsOnly(q)) && digitsOnly(q).length > 0) return true;
      if (c.mobile.toLowerCase().includes(q)) return true;
      return (c.records || []).some((r) => {
        const fields = [r.odSph, r.odCyl, r.odAxis, r.osSph, r.osCyl, r.osAxis, r.add, r.product, r.frameDetails, r.lensDetails, r.billId];
        return fields.some((f) => f !== undefined && f !== null && String(f).toLowerCase().includes(q));
      });
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [customers, searchQ]);

  /* ---- CRUD (writes go to Supabase; local `customers` state is updated directly since there's no realtime subscription) ---- */
  const addCustomer = async (form) => {
    const now = Date.now();
    const { name, mobile, dob, ...recordFields } = form;
    const record = { id: uid(), ...recordFields, createdAt: now };
    const customer = {
      id: uid(), name: form.name.trim(), mobile: form.mobile.trim(), dob: form.dob || "",
      createdAt: now, records: [record],
    };
    await saveCustomerRow(customer);
    setCustomers((prev) => [customer, ...prev]);
    setActiveId(customer.id);
    setView("profile");
    showToast("Customer saved");
  };

  const updateCustomerInfo = async (id, info) => {
    const cust = customers.find((c) => c.id === id);
    if (!cust) return;
    const updated = { ...cust, ...info };
    await saveCustomerRow(updated);
    setCustomers((prev) => prev.map((c) => (c.id === id ? updated : c)));
    showToast("Customer updated");
    setView("profile");
  };

  const addRecord = async (customerId, form) => {
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;
    const record = { id: uid(), ...form, createdAt: Date.now() };
    const updated = { ...cust, records: [...(cust.records || []), record] };
    await saveCustomerRow(updated);
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? updated : c)));
    showToast("Record added");
    setView("profile");
  };

  const updateRecord = async (customerId, recordId, form) => {
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;
    const records = cust.records.map((r) => (r.id === recordId ? { ...r, ...form } : r));
    const updated = { ...cust, records };
    await saveCustomerRow(updated);
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? updated : c)));
    showToast("Record updated");
    setView("profile");
  };

  const deleteRecord = async (customerId, recordId) => {
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;
    const updated = { ...cust, records: cust.records.filter((r) => r.id !== recordId) };
    await saveCustomerRow(updated);
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? updated : c)));
    showToast("Record deleted");
  };

  const deleteCustomer = async (customerId) => {
    await deleteCustomerRow(customerId);
    setCustomers((prev) => prev.filter((c) => c.id !== customerId));
    setView("customers");
    setActiveId(null);
    showToast("Customer deleted");
  };

  const generateBill = async (customerId, recordId) => {
    const cust = customers.find((c) => c.id === customerId);
    const rec = cust?.records.find((r) => r.id === recordId);
    if (!cust || !rec) return;
    let billId = rec.billId, billToken = rec.billToken, billDate = rec.billDate;
    if (!billId || !billToken) {
      billId = await nextBillId();
      billToken = genToken();
      billDate = billDate || new Date().toISOString().slice(0, 10);
      const records = cust.records.map((r) => (r.id === recordId ? { ...r, billId, billToken, billDate } : r));
      const updated = { ...cust, records };
      await saveCustomerRow(updated);
      setCustomers((prev) => prev.map((c) => (c.id === customerId ? updated : c)));
      // Public snapshot — only what a customer needs to see, keyed by the unguessable token
      await savePublicBillRow(billToken, {
        billId, billDate, customerName: cust.name, mobile: cust.mobile,
        odSph: rec.odSph, odCyl: rec.odCyl, odAxis: rec.odAxis,
        osSph: rec.osSph, osCyl: rec.osCyl, osAxis: rec.osAxis, add: rec.add,
        frameDetails: rec.frameDetails, lensDetails: rec.lensDetails, coating: rec.coating, product: rec.product,
        totalPrice: rec.totalPrice, discount: rec.discount, paymentStatus: rec.paymentStatus,
      });
    }
    setBillCtx({ customerId, recordId });
    setView("bill");
  };

  const exportCSV = () => {
    const csv = toCSV(customers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ks-opticals-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Export downloaded");
  };

  /* ---------- gate screens ---------- */

  // 1) Public bill link — anyone with the token, no login needed
  if (publicToken) {
    return <PublicBillRoute token={publicToken} />;
  }

  // 2) Supabase auth still resolving
  if (!authReady) {
    return <BootScreen />;
  }

  // 3) Not signed in — owner login
  if (!user) {
    return <LoginScreen onSignedIn={() => {}} showToast={showToast} />;
  }

  // 4) Signed in but customer data still loading
  if (!dataReady) {
    return <BootScreen />;
  }

  return (
    <div className="ks-root min-h-screen" style={{ background: COLORS.cream }}>
      <FontLoader />
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
      <ConfirmDialog {...(confirmState || { open: false })} />

      <div className="md:flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:flex-col md:w-60 md:min-h-screen md:px-5 md:py-6 md:sticky md:top-0"
          style={{ borderRight: `1px solid ${COLORS.line}`, background: COLORS.paper }}>
          <div className="mb-8"><Logo size="lg" /></div>
          <nav className="flex flex-col gap-1">
            {[
              { k: "dashboard", label: "Dashboard", icon: Home },
              { k: "customers", label: "Customers", icon: Users },
              { k: "add", label: "Add Customer", icon: Plus },
              { k: "settings", label: "Settings", icon: SettingsIcon },
            ].map(({ k, label, icon: Icon }) => (
              <button key={k} onClick={() => { setView(k); setActiveId(null); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: view === k ? COLORS.ink : "transparent",
                  color: view === k ? COLORS.paper : COLORS.ink,
                }}>
                <Icon size={17} />{label}
              </button>
            ))}
          </nav>
          <div className="mt-auto pt-6 text-[11px]" style={{ color: COLORS.muted }}>
            {customers.length} customers · {totalRecords} records
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-screen pb-24 md:pb-10">
          <div className="max-w-4xl mx-auto px-4 md:px-8 py-5 md:py-8">
            {view !== "dashboard" && view !== "customers" && view !== "settings" && view !== "add" && !active && null}

            {view === "dashboard" && (
              <Dashboard customers={customers} totalRecords={totalRecords} recentCustomers={recentCustomers}
                recentRecords={recentRecords} onAdd={() => setView("add")} onOpenCustomer={(id) => { setActiveId(id); setView("profile"); }}
                onSearch={(q) => { setSearchQ(q); setView("customers"); }} />
            )}

            {view === "customers" && (
              <CustomersList customers={filtered} searchQ={searchQ} setSearchQ={setSearchQ}
                onOpen={(id) => { setActiveId(id); setView("profile"); }} onAdd={() => setView("add")} />
            )}

            {view === "add" && (
              <AddCustomerForm onCancel={() => setView(customers.length ? "customers" : "dashboard")} onSave={addCustomer} />
            )}

            {view === "profile" && active && (
              <CustomerProfile
                customer={active}
                onBack={() => { setView("customers"); setActiveId(null); }}
                onEditInfo={() => setView("editInfo")}
                onAddRecord={() => setView("addRecord")}
                onEditRecord={(rid) => { setEditingRecordId(rid); setView("editRecord"); }}
                onDeleteRecord={(rid) => setConfirmState({
                  open: true, title: "Delete this record?",
                  body: "This eye-power/order record will be permanently removed. This cannot be undone.",
                  onCancel: () => setConfirmState(null),
                  onConfirm: async () => { await deleteRecord(active.id, rid); setConfirmState(null); },
                })}
                onDeleteCustomer={() => setConfirmState({
                  open: true, title: "Delete this customer?",
                  body: `${active.name} and their entire record history will be permanently deleted. This cannot be undone.`,
                  onCancel: () => setConfirmState(null),
                  onConfirm: async () => { await deleteCustomer(active.id); setConfirmState(null); },
                })}
                onGenerateBill={(rid) => generateBill(active.id, rid)}
              />
            )}

            {view === "bill" && billCtx && (() => {
              const bc = customers.find((c) => c.id === billCtx.customerId);
              const br = bc?.records.find((r) => r.id === billCtx.recordId);
              if (!bc || !br) return null;
              return <BillPage customer={bc} record={br} onBack={() => setView("profile")} showToast={showToast} />;
            })()}

            {view === "editInfo" && active && (
              <EditCustomerInfo customer={active} onCancel={() => setView("profile")}
                onSave={(info) => updateCustomerInfo(active.id, info)} />
            )}

            {view === "addRecord" && active && (
              <RecordForm title="Add New Record" onCancel={() => setView("profile")}
                onSave={(form) => addRecord(active.id, form)} />
            )}

            {view === "editRecord" && active && (
              <RecordForm title="Edit Record" initial={active.records.find((r) => r.id === editingRecordId)}
                onCancel={() => setView("profile")}
                onSave={(form) => updateRecord(active.id, editingRecordId, form)} />
            )}

            {view === "settings" && (
              <SettingsPage customers={customers} totalRecords={totalRecords} onExport={exportCSV}
                onChangePin={() => supabase.auth.signOut()} userEmail={user?.email}
                onOpenOffers={() => setView("offers")} />
            )}

            {view === "offers" && (
              <OffersPage offer={offer} batchInfo={batchInfo} onSave={saveOffer} onResetCycle={resetCycle}
                onBack={() => setView("settings")} onOpenBatch={() => setView("sendBatch")} />
            )}

            {view === "sendBatch" && (
              <SendBatchPage offer={offer} batchInfo={batchInfo} onBack={() => setView("offers")} showToast={showToast} />
            )}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex" style={{ background: COLORS.paper, borderTop: `1px solid ${COLORS.line}` }}>
        {[
          { k: "dashboard", label: "Dashboard", icon: Home },
          { k: "customers", label: "Customers", icon: Users },
          { k: "add", label: "Add", icon: Plus },
          { k: "settings", label: "Settings", icon: SettingsIcon },
        ].map(({ k, label, icon: Icon }) => {
          const isActive = view === k || (k === "customers" && view === "profile");
          return (
            <button key={k} onClick={() => { setView(k); setActiveId(null); }}
              className="flex-1 flex flex-col items-center gap-1 py-2.5">
              <Icon size={20} style={{ color: isActive ? COLORS.brass : COLORS.muted }} />
              <span className="text-[10px] font-medium" style={{ color: isActive ? COLORS.ink : COLORS.muted }}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ================= LOGIN SCREEN (Supabase email/password) ================= */
function LoginScreen({ showToast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) { setError("Enter your email and password"); return; }
    setBusy(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError("Incorrect email or password");
    setBusy(false);
  };

  return (
    <div className="ks-root min-h-screen flex items-center justify-center px-6" style={{ background: COLORS.ink }}>
      <FontLoader />
      <div className="w-full max-w-xs ks-rise">
        <div className="flex justify-center mb-8">
          <div className="flex items-center justify-center rounded-full" style={{ width: 56, height: 56, border: `1.5px solid ${COLORS.brass}` }}>
            <Glasses size={26} style={{ color: COLORS.brassLight }} />
          </div>
        </div>
        <h1 className="ks-display text-2xl text-center font-semibold mb-1" style={{ color: COLORS.paper }}>K.S OPTICALS</h1>
        <p className="text-center text-sm mb-8" style={{ color: "#B5B2AA" }}>Owner sign-in</p>

        <div className="relative mb-3">
          <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "#8A877F" }} />
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
            autoCapitalize="none"
            className="w-full pl-10 pr-4 py-3.5 rounded-xl outline-none text-sm"
            style={{ background: "rgba(255,255,255,0.06)", color: COLORS.paper, border: `1px solid rgba(255,255,255,0.15)` }}
            placeholder="owner@ksopticals.com"
          />
        </div>
        <div className="relative mb-3">
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full pl-4 pr-10 py-3.5 rounded-xl outline-none text-sm"
            style={{ background: "rgba(255,255,255,0.06)", color: COLORS.paper, border: `1px solid rgba(255,255,255,0.15)` }}
            placeholder="Password"
          />
          <button onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "#8A877F" }}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        {error && <p className="text-center text-xs mb-3" style={{ color: "#E08A7C" }}>{error}</p>}
        <button onClick={submit} disabled={busy} className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
          style={{ background: COLORS.brass, color: COLORS.ink, opacity: busy ? 0.7 : 1 }}>
          <Lock size={15} />{busy ? "Signing in…" : "Sign In"}
        </button>
        <p className="text-center text-[11px] mt-6" style={{ color: "#6E6B63" }}>
          Owner account is created in the Supabase Dashboard (Authentication → Users → Add user). K.S OPTICALS records stay private to that account.
        </p>
      </div>
    </div>
  );
}

/* ================= PUBLIC BILL ROUTE (no login, token-based) ================= */
function PublicBillRoute({ token }) {
  const [state, setState] = useState("loading"); // loading | notfound | ready
  const [bill, setBill] = useState(null);

  useEffect(() => {
    (async () => {
      const data = await fetchPublicBill(token);
      if (data) { setBill(data); setState("ready"); } else { setState("notfound"); }
    })();
  }, [token]);

  if (state === "loading") {
    return (
      <div className="ks-root min-h-screen flex items-center justify-center" style={{ background: COLORS.cream }}>
        <FontLoader /><Logo size="lg" />
      </div>
    );
  }
  if (state === "notfound") {
    return (
      <div className="ks-root min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: COLORS.cream }}>
        <FontLoader />
        <AlertTriangle size={28} style={{ color: COLORS.danger }} className="mb-3" />
        <h1 className="ks-display text-xl font-semibold mb-1" style={{ color: COLORS.ink }}>Bill not found</h1>
        <p className="text-sm" style={{ color: COLORS.muted }}>This link is invalid or the bill was removed. Please contact K.S OPTICALS.</p>
      </div>
    );
  }

  const finalAmount = (parseFloat(bill.totalPrice) || 0) - (parseFloat(bill.discount) || 0);
  const status = PAY_STATUS[bill.paymentStatus] || PAY_STATUS.Pending;

  return (
    <div className="ks-root min-h-screen py-8 px-4" style={{ background: COLORS.cream }}>
      <FontLoader />
      <div className="max-w-md mx-auto">
        <BillCard
          billId={bill.billId} billDate={bill.billDate}
          customerName={bill.customerName} mobile={bill.mobile}
          record={bill} finalAmount={finalAmount} status={status}
        />
      </div>
    </div>
  );
}

/* ================= DASHBOARD ================= */
function Dashboard({ customers, totalRecords, recentCustomers, recentRecords, onAdd, onOpenCustomer, onSearch }) {
  const [q, setQ] = useState("");
  return (
    <div className="ks-rise">
      <div className="flex items-center justify-between mb-6 md:hidden">
        <Logo size="lg" />
      </div>

      <button onClick={onAdd} className="w-full mb-6 rounded-2xl px-5 py-5 flex items-center justify-between group transition-transform active:scale-[0.99]"
        style={{ background: COLORS.ink }}>
        <div className="text-left">
          <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: COLORS.brassLight }}>New Entry</div>
          <div className="ks-display text-xl font-semibold" style={{ color: COLORS.paper }}>+ Add Customer</div>
        </div>
        <div className="rounded-full p-3" style={{ background: "rgba(255,255,255,0.08)" }}>
          <Plus size={20} style={{ color: COLORS.paper }} />
        </div>
      </button>

      <div className="relative mb-6">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: COLORS.muted }} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q.trim() && onSearch(q)}
          placeholder="Quick search — name, mobile, or power"
          className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none"
          style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <SectionCard>
          <div className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: COLORS.brass }}>Total Customers</div>
          <div className="ks-display text-3xl font-semibold" style={{ color: COLORS.ink }}>{customers.length}</div>
        </SectionCard>
        <SectionCard>
          <div className="text-[11px] uppercase tracking-widest font-semibold mb-1" style={{ color: COLORS.brass }}>Total Records</div>
          <div className="ks-display text-3xl font-semibold" style={{ color: COLORS.ink }}>{totalRecords}</div>
        </SectionCard>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="ks-display text-base font-semibold" style={{ color: COLORS.ink }}>Recent Customers</h2>
        </div>
        {recentCustomers.length === 0 ? (
          <EmptyRow text="No customers yet. Add your first one above." />
        ) : (
          <div className="flex flex-col gap-2">
            {recentCustomers.map((c) => (
              <CustomerRow key={c.id} customer={c} onClick={() => onOpenCustomer(c.id)} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="ks-display text-base font-semibold mb-3" style={{ color: COLORS.ink }}>Recently Added Records</h2>
        {recentRecords.length === 0 ? (
          <EmptyRow text="No orders recorded yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {recentRecords.map((r) => (
              <div key={r.id} onClick={() => onOpenCustomer(r.customerId)}
                className="rounded-xl px-4 py-3 flex items-center justify-between cursor-pointer transition-colors"
                style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}>
                <div>
                  <div className="text-sm font-semibold" style={{ color: COLORS.ink }}>{r.customerName}</div>
                  <div className="text-xs mt-0.5 truncate max-w-[220px]" style={{ color: COLORS.muted }}>{r.product || "No product details"}</div>
                </div>
                <div className="text-[11px] text-right" style={{ color: COLORS.muted }}>{fmtDate(r.orderDate)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const EmptyRow = ({ text }) => (
  <div className="rounded-xl px-4 py-6 text-center text-sm" style={{ background: COLORS.paper, border: `1px dashed ${COLORS.line}`, color: COLORS.muted }}>
    {text}
  </div>
);

function CustomerRow({ customer, onClick }) {
  const rec = latestRecord(customer);
  return (
    <div onClick={onClick} className="rounded-xl px-4 py-3.5 flex items-center justify-between cursor-pointer transition-colors"
      style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 38, height: 38, background: COLORS.cream, color: COLORS.brass }}>
          <span className="text-sm font-semibold ks-display">{customer.name?.[0]?.toUpperCase() || "?"}</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: COLORS.ink }}>{customer.name}</div>
          <div className="text-xs mt-0.5" style={{ color: COLORS.muted }}>{customer.mobile}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {rec && (
          <div className="text-right hidden sm:block">
            <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.brass }}>OD/OS</div>
            <div className="ks-mono text-xs" style={{ color: COLORS.ink }}>{powerStr(rec.odSph)} / {powerStr(rec.osSph)}</div>
          </div>
        )}
        <ChevronRight size={16} style={{ color: COLORS.muted }} />
      </div>
    </div>
  );
}

/* ================= CUSTOMERS LIST ================= */
function CustomersList({ customers, searchQ, setSearchQ, onOpen, onAdd }) {
  return (
    <div className="ks-rise">
      <div className="flex items-center justify-between mb-5">
        <h1 className="ks-display text-2xl font-semibold" style={{ color: COLORS.ink }}>Customers</h1>
        <button onClick={onAdd} className="hidden md:flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: COLORS.ink, color: COLORS.paper }}>
          <Plus size={15} /> Add
        </button>
      </div>

      <div className="relative mb-4 sticky top-0 z-10 pt-1 pb-1" style={{ background: COLORS.cream }}>
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: COLORS.muted }} />
        <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} autoFocus={false}
          placeholder="Search name, mobile, SPH, CYL, axis, product…"
          className="w-full pl-10 pr-9 py-3.5 rounded-xl text-sm outline-none shadow-sm"
          style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }} />
        {searchQ && (
          <button onClick={() => setSearchQ("")} className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <X size={16} style={{ color: COLORS.muted }} />
          </button>
        )}
      </div>

      <div className="text-xs mb-3" style={{ color: COLORS.muted }}>{customers.length} result{customers.length !== 1 ? "s" : ""}</div>

      {customers.length === 0 ? (
        <EmptyRow text={searchQ ? "No matching customers found." : "No customers yet."} />
      ) : (
        <div className="flex flex-col gap-2">
          {customers.map((c) => <CustomerRow key={c.id} customer={c} onClick={() => onOpen(c.id)} />)}
        </div>
      )}
    </div>
  );
}

/* ================= ADD CUSTOMER FORM ================= */
const emptyRecordForm = {
  odSph: "", odCyl: "", odAxis: "", osSph: "", osCyl: "", osAxis: "", add: "",
  product: "", frameDetails: "", lensDetails: "", coating: "",
  orderDate: "", deliveryDate: "", billDate: "",
  totalPrice: "", discount: "", paymentStatus: "Pending", notes: "",
  billId: "", billToken: "",
};

function AddCustomerForm({ onCancel, onSave }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [dob, setDob] = useState("");
  const [rec, setRec] = useState(emptyRecordForm);
  const [err, setErr] = useState("");

  const upd = (k, v) => setRec((r) => ({ ...r, [k]: v }));

  const save = () => {
    if (!name.trim()) return setErr("Customer name is required");
    if (normalizeMobile(mobile).length !== 10) return setErr("Enter a valid 10-digit mobile number");
    setErr("");
    onSave({ name, mobile: formatMobileFull(mobile), dob, ...rec });
  };

  return (
    <FormShell title="Add Customer" onCancel={onCancel}>
      <FormSection label="Customer Information">
        <Field label="Customer Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fardeen Khan" /></Field>
        <Field label="Mobile Number" required hint="+91 is added automatically"><MobileInput value={mobile} onChange={setMobile} /></Field>
        <Field label="Date of Birth"><TextInput type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
      </FormSection>

      <EyePowerFields rec={rec} upd={upd} />

      <FormSection label="Product / Lens / Frame Details">
        <Field label="Product / Lens / Frame Details" hint="Type freely — e.g. Crizal Easy + Titan Frame">
          <TextArea rows={3} value={rec.product} onChange={(e) => upd("product", e.target.value)} placeholder="Crizal Easy + Titan Frame" />
        </Field>
      </FormSection>

      <BillingFields rec={rec} upd={upd} />

      <FormSection label="Dates">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order Date"><TextInput type="date" value={rec.orderDate} onChange={(e) => upd("orderDate", e.target.value)} /></Field>
          <Field label="Delivery Date"><TextInput type="date" value={rec.deliveryDate} onChange={(e) => upd("deliveryDate", e.target.value)} /></Field>
        </div>
      </FormSection>

      <FormSection label="Notes">
        <Field label="Notes"><TextArea rows={3} value={rec.notes} onChange={(e) => upd("notes", e.target.value)} placeholder="Any additional information…" /></Field>
      </FormSection>

      {err && <p className="text-sm mb-3" style={{ color: COLORS.danger }}>{err}</p>}
      <div className="flex gap-3">
        <GhostBtn className="flex-1" onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn className="flex-1" onClick={save}>Save Customer</PrimaryBtn>
      </div>
    </FormShell>
  );
}

/* ---------- shared billing fields block ---------- */
function BillingFields({ rec, upd }) {
  const final = (parseFloat(rec.totalPrice) || 0) - (parseFloat(rec.discount) || 0);
  return (
    <FormSection label="Billing">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Frame Details"><TextInput value={rec.frameDetails} onChange={(e) => upd("frameDetails", e.target.value)} placeholder="Titan Frame TX123" /></Field>
        <Field label="Lens Details"><TextInput value={rec.lensDetails} onChange={(e) => upd("lensDetails", e.target.value)} placeholder="Crizal Easy Progressive" /></Field>
      </div>
      <Field label="Coating" hint="Optional"><TextInput value={rec.coating} onChange={(e) => upd("coating", e.target.value)} placeholder="Blue Cut / Anti-Glare" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Total Price (₹)"><TextInput inputMode="decimal" value={rec.totalPrice} onChange={(e) => upd("totalPrice", e.target.value)} placeholder="3500" /></Field>
        <Field label="Discount (₹)"><TextInput inputMode="decimal" value={rec.discount} onChange={(e) => upd("discount", e.target.value)} placeholder="200" /></Field>
      </div>
      <div className="rounded-lg px-3.5 py-2.5 flex items-center justify-between mb-4" style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}>
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: COLORS.muted }}>Final Amount</span>
        <span className="ks-mono font-semibold text-[15px]" style={{ color: COLORS.ink }}>₹{money(final)}</span>
      </div>
      <Field label="Payment Status">
        <div className="grid grid-cols-3 gap-2">
          {Object.keys(PAY_STATUS).map((s) => (
            <button type="button" key={s} onClick={() => upd("paymentStatus", s)}
              className="py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={{
                background: rec.paymentStatus === s ? PAY_STATUS[s].color : COLORS.paper,
                color: rec.paymentStatus === s ? "#fff" : COLORS.ink,
                border: `1px solid ${rec.paymentStatus === s ? PAY_STATUS[s].color : COLORS.line}`,
              }}>
              {s}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Bill Date" hint="Defaults to today when the bill is generated"><TextInput type="date" value={rec.billDate} onChange={(e) => upd("billDate", e.target.value)} /></Field>
    </FormSection>
  );
}

function EyePowerFields({ rec, upd }) {
  return (
    <FormSection label="Eye Power">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-1">
        <div className="rounded-xl p-4" style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLORS.brass }}>Right Eye (OD)</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="SPH"><TextInput value={rec.odSph} onChange={(e) => upd("odSph", e.target.value)} placeholder="-2.50" /></Field>
            <Field label="CYL"><TextInput value={rec.odCyl} onChange={(e) => upd("odCyl", e.target.value)} placeholder="-0.75" /></Field>
            <Field label="Axis"><TextInput value={rec.odAxis} onChange={(e) => upd("odAxis", e.target.value)} placeholder="90" /></Field>
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: COLORS.cream, border: `1px solid ${COLORS.line}` }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLORS.brass }}>Left Eye (OS)</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="SPH"><TextInput value={rec.osSph} onChange={(e) => upd("osSph", e.target.value)} placeholder="-2.25" /></Field>
            <Field label="CYL"><TextInput value={rec.osCyl} onChange={(e) => upd("osCyl", e.target.value)} placeholder="-0.50" /></Field>
            <Field label="Axis"><TextInput value={rec.osAxis} onChange={(e) => upd("osAxis", e.target.value)} placeholder="85" /></Field>
          </div>
        </div>
      </div>
      <Field label="ADD" hint="Optional"><TextInput value={rec.add} onChange={(e) => upd("add", e.target.value)} placeholder="+1.50" /></Field>
    </FormSection>
  );
}

function FormShell({ title, onCancel, children }) {
  return (
    <div className="ks-rise">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onCancel} className="p-1 -ml-1"><ArrowLeft size={19} style={{ color: COLORS.ink }} /></button>
        <h1 className="ks-display text-2xl font-semibold" style={{ color: COLORS.ink }}>{title}</h1>
      </div>
      {children}
    </div>
  );
}

function FormSection({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-[11px] uppercase tracking-widest font-bold mb-2.5" style={{ color: COLORS.ink }}>{label}</div>
      {children}
    </div>
  );
}

/* ================= RECORD FORM (add/edit) ================= */
function RecordForm({ title, initial, onCancel, onSave }) {
  const [rec, setRec] = useState(initial ? { ...emptyRecordForm, ...initial } : emptyRecordForm);
  const upd = (k, v) => setRec((r) => ({ ...r, [k]: v }));
  return (
    <FormShell title={title} onCancel={onCancel}>
      <EyePowerFields rec={rec} upd={upd} />
      <FormSection label="Product / Lens / Frame Details">
        <Field label="Product / Lens / Frame Details"><TextArea rows={3} value={rec.product} onChange={(e) => upd("product", e.target.value)} placeholder="Progressive Lens + Ray-Ban Frame" /></Field>
      </FormSection>
      <BillingFields rec={rec} upd={upd} />
      <FormSection label="Dates">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order Date"><TextInput type="date" value={rec.orderDate} onChange={(e) => upd("orderDate", e.target.value)} /></Field>
          <Field label="Delivery Date"><TextInput type="date" value={rec.deliveryDate} onChange={(e) => upd("deliveryDate", e.target.value)} /></Field>
        </div>
      </FormSection>
      <FormSection label="Notes">
        <Field label="Notes"><TextArea rows={3} value={rec.notes} onChange={(e) => upd("notes", e.target.value)} placeholder="Any additional information…" /></Field>
      </FormSection>
      <div className="flex gap-3">
        <GhostBtn className="flex-1" onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn className="flex-1" onClick={() => onSave(rec)}>Save Record</PrimaryBtn>
      </div>
    </FormShell>
  );
}

/* ================= EDIT CUSTOMER INFO ================= */
function EditCustomerInfo({ customer, onCancel, onSave }) {
  const [name, setName] = useState(customer.name);
  const [mobile, setMobile] = useState(normalizeMobile(customer.mobile));
  const [dob, setDob] = useState(customer.dob || "");
  const [err, setErr] = useState("");
  const save = () => {
    if (!name.trim()) return setErr("Customer name is required");
    if (normalizeMobile(mobile).length !== 10) return setErr("Enter a valid 10-digit mobile number");
    onSave({ name: name.trim(), mobile: formatMobileFull(mobile), dob });
  };
  return (
    <FormShell title="Edit Customer" onCancel={onCancel}>
      <FormSection label="Customer Information">
        <Field label="Customer Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile Number" required hint="+91 is added automatically"><MobileInput value={mobile} onChange={setMobile} /></Field>
        <Field label="Date of Birth"><TextInput type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
      </FormSection>
      {err && <p className="text-sm mb-3" style={{ color: COLORS.danger }}>{err}</p>}
      <div className="flex gap-3">
        <GhostBtn className="flex-1" onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn className="flex-1" onClick={save}>Save Changes</PrimaryBtn>
      </div>
    </FormShell>
  );
}

/* ================= CUSTOMER PROFILE ================= */
function CustomerProfile({ customer, onBack, onEditInfo, onAddRecord, onEditRecord, onDeleteRecord, onDeleteCustomer, onGenerateBill }) {
  const history = useMemo(() => [...customer.records].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || "") || b.createdAt - a.createdAt), [customer]);

  return (
    <div className="ks-rise">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-1 -ml-1"><ArrowLeft size={19} style={{ color: COLORS.ink }} /></button>
        <h1 className="ks-display text-xl font-semibold truncate" style={{ color: COLORS.ink }}>{customer.name}</h1>
      </div>

      <SectionCard className="mb-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-full" style={{ width: 48, height: 48, background: COLORS.cream, color: COLORS.brass }}>
              <span className="ks-display text-lg font-semibold">{customer.name?.[0]?.toUpperCase()}</span>
            </div>
            <div>
              <div className="font-semibold" style={{ color: COLORS.ink }}>{customer.name}</div>
              <div className="text-sm mt-0.5" style={{ color: COLORS.muted }}>{customer.mobile}</div>
              {customer.dob && <div className="text-xs mt-0.5" style={{ color: COLORS.muted }}>DOB: {fmtDate(customer.dob)}</div>}
            </div>
          </div>
          <button onClick={onEditInfo}><Pencil size={16} style={{ color: COLORS.muted }} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <a href={`tel:+${mobileDialDigits(customer.mobile)}`} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: COLORS.ink, color: COLORS.paper }}>
            <Phone size={15} /> Call
          </a>
          <a href={waLink(customer.mobile)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: "#25D366", color: "#fff" }}>
            <MessageCircle size={15} /> WhatsApp
          </a>
        </div>
        <a href={waBusinessLink(customer.mobile)} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold mb-2.5"
          style={{ background: "#1F5C4A", color: "#fff" }}>
          <Briefcase size={15} /> WhatsApp Business
        </a>
        <button onClick={onDeleteCustomer} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold"
          style={{ color: COLORS.danger }}>
          <Trash2 size={13} /> Delete Customer
        </button>
      </SectionCard>

      <button onClick={onAddRecord} className="w-full mb-5 rounded-xl px-4 py-3.5 flex items-center justify-center gap-2 font-semibold text-sm"
        style={{ border: `1.5px dashed ${COLORS.brass}`, color: COLORS.brass }}>
        <Plus size={16} /> Add New Record
      </button>

      <div className="flex items-center justify-between mb-3">
        <h2 className="ks-display text-base font-semibold" style={{ color: COLORS.ink }}>History</h2>
        <span className="text-xs" style={{ color: COLORS.muted }}>{history.length} record{history.length !== 1 ? "s" : ""}</span>
      </div>

      {history.length === 0 ? (
        <EmptyRow text="No records yet. Add one above." />
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((r, i) => (
            <SectionCard key={r.id}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Calendar size={14} style={{ color: COLORS.brass }} />
                  <div className="text-sm font-semibold" style={{ color: COLORS.ink }}>
                    {fmtDate(r.orderDate)} {r.deliveryDate && <span style={{ color: COLORS.muted, fontWeight: 400 }}>→ delivered {fmtDate(r.deliveryDate)}</span>}
                  </div>
                  {i === 0 && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: COLORS.brass, color: "#fff" }}>Latest</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => onEditRecord(r.id)}><Pencil size={14} style={{ color: COLORS.muted }} /></button>
                  <button onClick={() => onDeleteRecord(r.id)}><Trash2 size={14} style={{ color: COLORS.danger }} /></button>
                </div>
              </div>

              <PowerGrid record={r} />

              {r.product && (
                <div className="mt-3 flex items-start gap-2">
                  <FileText size={13} className="mt-0.5 shrink-0" style={{ color: COLORS.brass }} />
                  <p className="text-sm" style={{ color: COLORS.ink }}>{r.product}</p>
                </div>
              )}
              {(r.frameDetails || r.lensDetails || r.coating) && (
                <div className="mt-2 text-xs" style={{ color: COLORS.muted }}>
                  {r.frameDetails && <div>Frame: <span style={{ color: COLORS.ink }}>{r.frameDetails}</span></div>}
                  {r.lensDetails && <div>Lens: <span style={{ color: COLORS.ink }}>{r.lensDetails}</span></div>}
                  {r.coating && <div>Coating: <span style={{ color: COLORS.ink }}>{r.coating}</span></div>}
                </div>
              )}
              {(r.totalPrice || r.discount) && (
                <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: COLORS.cream }}>
                  <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: COLORS.brass }}>Final Amount</span>
                  <span className="ks-mono text-sm font-semibold" style={{ color: COLORS.ink }}>
                    ₹{money((parseFloat(r.totalPrice) || 0) - (parseFloat(r.discount) || 0))}
                  </span>
                </div>
              )}
              {r.paymentStatus && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: PAY_STATUS[r.paymentStatus]?.bg, color: PAY_STATUS[r.paymentStatus]?.color }}>
                  {PAY_STATUS[r.paymentStatus]?.icon} {r.paymentStatus}
                </div>
              )}
              {r.notes && (
                <p className="mt-2 text-xs italic" style={{ color: COLORS.muted }}>{r.notes}</p>
              )}
              <button onClick={() => onGenerateBill(r.id)}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold"
                style={{ background: COLORS.ink, color: COLORS.paper }}>
                <Receipt size={13} /> {r.billId ? `View Bill · ${r.billId}` : "Generate Bill Link"}
              </button>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- PDF generation (loads jsPDF from CDN, builds a real downloadable/shareable PDF) ---------- */
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

function useJsPDF() {
  const [ready, setReady] = useState(typeof window !== "undefined" && !!window.jspdf);
  useEffect(() => {
    if (ready || typeof window === "undefined") return;
    if (window.jspdf) { setReady(true); return; }
    let existing = document.querySelector(`script[src="${JSPDF_CDN}"]`);
    if (!existing) {
      existing = document.createElement("script");
      existing.src = JSPDF_CDN;
      existing.async = true;
      document.head.appendChild(existing);
    }
    const onLoad = () => setReady(true);
    existing.addEventListener("load", onLoad);
    if (window.jspdf) setReady(true);
    return () => existing.removeEventListener("load", onLoad);
  }, [ready]);
  return ready;
}

function buildBillPDF(customer, r) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 48;
  const contentW = pageW - marginX * 2;
  let y = 56;

  const ink = "#101010", brass = "#9C7C4E", muted = "#726F68", line = "#DAD6CD";
  const center = (txt, yy, size, style = "normal", color = ink) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(color);
    doc.text(txt, pageW / 2, yy, { align: "center" });
  };
  const left = (txt, x, yy, size, style = "normal", color = ink) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(color);
    doc.text(String(txt), x, yy);
  };
  const right = (txt, x, yy, size, style = "normal", color = ink) => {
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(color);
    doc.text(String(txt), x, yy, { align: "right" });
  };
  const hr = (yy) => { doc.setDrawColor(line); doc.setLineWidth(0.75); doc.line(marginX, yy, pageW - marginX, yy); };
  const sectionLabel = (txt, yy) => { left(txt.toUpperCase(), marginX, yy, 9, "bold", brass); };

  // Header
  center("K.S OPTICALS", y, 22, "bold"); y += 16;
  center("SEE BETTER  ·  LOOK BETTER  ·  LIVE BETTER", y, 8.5, "normal", brass); y += 16;
  center(SHOP_ADDRESS, y, 8.5, "normal", muted); y += 12;
  center(`Ph: ${SHOP_PHONE}`, y, 8.5, "normal", muted); y += 16;
  center("DIGITAL BILL", y, 9, "bold", muted); y += 14;
  hr(y); y += 26;

  left(`Bill No.  ${r.billId || "-"}`, marginX, y, 10.5, "bold");
  right(`Date  ${fmtDate(r.billDate)}`, pageW - marginX, y, 10.5, "bold");
  y += 30;

  sectionLabel("Customer Details", y); y += 16;
  left(`Name: ${customer.name}`, marginX, y, 10.5); y += 15;
  left(`Mobile: ${customer.mobile}`, marginX, y, 10.5); y += 26;

  sectionLabel("Eye Power", y); y += 12;
  // table
  const tblY = y, rowH = 22, colW = [contentW * 0.22, contentW * 0.26, contentW * 0.26, contentW * 0.26];
  const colX = [marginX, marginX + colW[0], marginX + colW[0] + colW[1], marginX + colW[0] + colW[1] + colW[2]];
  doc.setDrawColor(line); doc.setLineWidth(0.75);
  doc.rect(marginX, tblY, contentW, rowH * 3);
  for (let i = 1; i < 4; i++) doc.line(marginX, tblY + rowH * i, pageW - marginX, tblY + rowH * i);
  for (let i = 1; i < 4; i++) doc.line(colX[i], tblY, colX[i], tblY + rowH * 3);
  const rowLabels = ["Eye", "OD (Right)", "OS (Left)"];
  const heads = ["", "SPH", "CYL", "AXIS"];
  heads.forEach((h, i) => center(h, tblY + 14, 9, "bold", brass) && null);
  // header row text (centered per column)
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(brass);
  heads.forEach((h, i) => { if (h) doc.text(h, colX[i] + colW[i] / 2, tblY + 14, { align: "center" }); });
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(ink);
  doc.text("OD (R)", marginX + 8, tblY + rowH + 14);
  doc.text("OS (L)", marginX + 8, tblY + rowH * 2 + 14);
  doc.setFont("helvetica", "normal");
  const odVals = [powerStr(r.odSph), powerStr(r.odCyl), powerStr(r.odAxis)];
  const osVals = [powerStr(r.osSph), powerStr(r.osCyl), powerStr(r.osAxis)];
  odVals.forEach((v, i) => doc.text(v, colX[i + 1] + colW[i + 1] / 2, tblY + rowH + 14, { align: "center" }));
  osVals.forEach((v, i) => doc.text(v, colX[i + 1] + colW[i + 1] / 2, tblY + rowH * 2 + 14, { align: "center" }));
  y = tblY + rowH * 3 + 18;
  if (r.add) { left(`ADD: ${r.add}`, marginX, y, 10); y += 20; }

  if (r.frameDetails || r.lensDetails || r.coating || r.product) {
    sectionLabel("Product Details", y); y += 16;
    if (r.frameDetails) { left(`Frame: ${r.frameDetails}`, marginX, y, 10.5); y += 15; }
    if (r.lensDetails) { left(`Lens: ${r.lensDetails}`, marginX, y, 10.5); y += 15; }
    if (r.coating) { left(`Coating: ${r.coating}`, marginX, y, 10.5); y += 15; }
    if (r.product) {
      const lines = doc.splitTextToSize(r.product, contentW);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(ink);
      doc.text(lines, marginX, y); y += lines.length * 13;
    }
    y += 10;
  }

  sectionLabel("Payment Summary", y); y += 14;
  const final = (parseFloat(r.totalPrice) || 0) - (parseFloat(r.discount) || 0);
  const payRows = [["Total", `₹${money(r.totalPrice)}`], ["Discount", `₹${money(r.discount)}`], ["Final Amount", `₹${money(final)}`], ["Payment Status", (r.paymentStatus || "Pending").toUpperCase()]];
  const payRowH = 22;
  doc.setDrawColor(line);
  doc.rect(marginX, y, contentW, payRowH * payRows.length);
  payRows.forEach((row, i) => {
    if (i > 0) doc.line(marginX, y + payRowH * i, pageW - marginX, y + payRowH * i);
    const ry = y + payRowH * i + 14;
    left(row[0], marginX + 10, ry, 10, i === payRows.length - 1 ? "bold" : "normal", muted);
    right(row[1], pageW - marginX - 10, ry, 10.5, "bold", ink);
  });
  y += payRowH * payRows.length + 34;

  hr(y); y += 24;
  center("Thank you for shopping with K.S OPTICALS!", y, 11, "bold"); y += 18;
  doc.setTextColor(brass); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.textWithLink("Enjoyed our service? Rate us on Google", pageW / 2, y, { url: GOOGLE_REVIEW_LINK, align: "center" });

  return doc;
}

function billFileName(r) {
  return `KS-Bill-${(r.billId || "draft").replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}


const GOOGLE_REVIEW_LINK = "https://g.page/r/CVt93LY34PvHEBM/review";
const SHOP_ADDRESS = "Shop no.10 GF, Shivam Plaza, Delta-1, Greater Noida";
const SHOP_PHONE = "+91 8006316553";

function waMessagePdf(customerName) {
  return `Hello ${customerName} 👋

Thank you for choosing K.S OPTICALS! 👓
Please find your digital bill attached — it has your order details, eye power, frame/lens details and payment information.

We'd also love to hear from you! ⭐
If you're happy with our service, please leave us a Google Review:
⭐ ${GOOGLE_REVIEW_LINK}

Thank you for your trust and support. ❤️
K.S OPTICALS
SEE BETTER. LOOK BETTER. LIVE BETTER.`;
}

function waMessage(customerName, billLink) {
  return `Hello ${customerName} 👋

Thank you for choosing K.S OPTICALS! 👓
Your digital bill is ready. You can view your order details, eye power, frame/lens details and payment information here:

🔗 View Your Bill: ${billLink}

We'd also love to hear from you! ⭐
If you're happy with our service, please leave us a Google Review:
⭐ ${GOOGLE_REVIEW_LINK}

Thank you for your trust and support. ❤️
K.S OPTICALS
SEE BETTER. LOOK BETTER. LIVE BETTER.`;
}

/* ---------- Shared printable bill card (used by admin preview AND the public /bill/:token page) ---------- */
function BillCard({ billId, billDate, customerName, mobile, record: r, finalAmount, status }) {
  return (
    <div className="ks-bill-print rounded-2xl p-6 md:p-8" style={{ background: COLORS.paper, border: `1px solid ${COLORS.line}` }}>
      <div className="text-center pb-5 mb-5" style={{ borderBottom: `1.5px solid ${COLORS.ink}` }}>
        <div className="flex justify-center mb-2">
          <div className="flex items-center justify-center rounded-full" style={{ width: 44, height: 44, border: `1.5px solid ${COLORS.brass}` }}>
            <Glasses size={20} style={{ color: COLORS.brass }} />
          </div>
        </div>
        <div className="ks-display text-2xl font-semibold" style={{ color: COLORS.ink }}>K.S OPTICALS</div>
        <div className="text-[10px] uppercase tracking-[0.15em] mt-1" style={{ color: COLORS.brass }}>See Better. Look Better. Live Better.</div>
        <div className="text-[11px] mt-2" style={{ color: COLORS.muted }}>{SHOP_ADDRESS}</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.muted }}>📞 {SHOP_PHONE}</div>
        <div className="text-[11px] uppercase tracking-widest font-bold mt-3" style={{ color: COLORS.muted }}>Digital Bill</div>
      </div>

      <div className="flex justify-between text-sm mb-5">
        <div><span style={{ color: COLORS.muted }}>Bill No.</span> <span className="ks-mono font-semibold" style={{ color: COLORS.ink }}>{billId}</span></div>
        <div><span style={{ color: COLORS.muted }}>Date</span> <span className="font-semibold" style={{ color: COLORS.ink }}>{fmtDate(billDate)}</span></div>
      </div>

      <div className="mb-5">
        <div className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: COLORS.brass }}>Customer Details</div>
        <div className="text-sm" style={{ color: COLORS.ink }}>Name: <strong>{customerName}</strong></div>
        <div className="text-sm" style={{ color: COLORS.ink }}>Mobile: {mobile}</div>
      </div>

      <div className="mb-5">
        <div className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: COLORS.brass }}>Eye Power</div>
        <PowerGrid record={r} />
      </div>

      {(r.frameDetails || r.lensDetails || r.coating || r.product) && (
        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: COLORS.brass }}>Product Details</div>
          <div className="text-sm space-y-0.5" style={{ color: COLORS.ink }}>
            {r.frameDetails && <div>Frame: {r.frameDetails}</div>}
            {r.lensDetails && <div>Lens: {r.lensDetails}</div>}
            {r.coating && <div>Coating: {r.coating}</div>}
            {r.product && <div>{r.product}</div>}
          </div>
        </div>
      )}

      <div className="mb-2">
        <div className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: COLORS.brass }}>Payment Summary</div>
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
          <div className="flex justify-between px-4 py-2 text-sm" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
            <span style={{ color: COLORS.muted }}>Total</span><span className="ks-mono" style={{ color: COLORS.ink }}>₹{money(r.totalPrice)}</span>
          </div>
          <div className="flex justify-between px-4 py-2 text-sm" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
            <span style={{ color: COLORS.muted }}>Discount</span><span className="ks-mono" style={{ color: COLORS.ink }}>₹{money(r.discount)}</span>
          </div>
          <div className="flex justify-between px-4 py-2.5 text-sm font-semibold" style={{ background: COLORS.cream, borderBottom: `1px solid ${COLORS.line}` }}>
            <span style={{ color: COLORS.ink }}>Final Amount</span><span className="ks-mono" style={{ color: COLORS.ink }}>₹{money(finalAmount)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-2.5 text-sm">
            <span style={{ color: COLORS.muted }}>Payment Status</span>
            <span className="font-semibold" style={{ color: status.color }}>{status.icon} {r.paymentStatus?.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div className="text-center pt-6 mt-6" style={{ borderTop: `1px solid ${COLORS.line}` }}>
        <p className="text-sm mb-4" style={{ color: COLORS.ink }}>Thank you for shopping with K.S OPTICALS! ❤️</p>
        <a href={GOOGLE_REVIEW_LINK} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background: COLORS.brass, color: "#fff" }}>
          <Star size={14} /> RATE US ON GOOGLE
        </a>
      </div>
    </div>
  );
}

function BillPage({ customer, record: r, onBack, showToast }) {
  const billLink = billLinkFor(r.billToken);
  const finalAmount = (parseFloat(r.totalPrice) || 0) - (parseFloat(r.discount) || 0);
  const status = PAY_STATUS[r.paymentStatus] || PAY_STATUS.Pending;
  const pdfReady = useJsPDF();
  const [busy, setBusy] = useState(false);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(billLink); showToast("Bill link copied"); }
    catch { showToast("Could not copy — copy manually"); }
  };

  const makePdfFile = () => {
    const doc = buildBillPDF(customer, r);
    const blob = doc.output("blob");
    return new File([blob], billFileName(r), { type: "application/pdf" });
  };

  const downloadPdf = () => {
    if (!pdfReady || !window.jspdf) { showToast("PDF engine still loading — try again in a second"); return; }
    setBusy(true);
    try {
      const doc = buildBillPDF(customer, r);
      // Try opening the PDF directly — most webviews show a native PDF viewer with its own Save/Share icon,
      // which is far more reliable than a programmatic blob download inside an embedded browser.
      const blobUrl = doc.output("bloburl");
      const win = window.open(blobUrl, "_blank");
      if (!win) {
        // Popup blocked — fall back to a data-URI anchor click
        const dataUri = doc.output("datauristring");
        const a = document.createElement("a");
        a.href = dataUri; a.download = billFileName(r); a.target = "_blank";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
      showToast("PDF opened — tap the Save/Share icon at the top to save it");
    } catch (e) { console.error(e); showToast("Couldn't generate PDF — please retry"); }
    setBusy(false);
  };

  const shareLinkToWhatsApp = () => {
    window.open(waLink(customer.mobile, waMessage(customer.name, billLink)), "_blank");
  };

  const shareLinkToWhatsAppBusiness = () => {
    window.open(waBusinessLink(customer.mobile, waMessage(customer.name, billLink)), "_blank");
  };

  const shareToWhatsApp = async () => {
    if (!pdfReady || !window.jspdf) { showToast("PDF engine still loading — try again in a second"); return; }
    setBusy(true);
    try {
      const file = makePdfFile();
      const text = waMessagePdf(customer.name);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: `K.S OPTICALS Bill ${r.billId || ""}` });
        showToast("Pick WhatsApp in the share sheet");
      } else {
        // Fallback: browser can't attach files — download the PDF and open a prefilled WhatsApp chat to attach manually
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url; a.download = file.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.open(waLink(customer.mobile, text), "_blank");
        showToast("PDF downloaded — attach it in the WhatsApp chat");
      }
    } catch (e) {
      if (e?.name !== "AbortError") { console.error(e); showToast("Couldn't share — please retry"); }
    }
    setBusy(false);
  };

  return (
    <div className="ks-rise">
      <div className="flex items-center gap-3 mb-5 no-print">
        <button onClick={onBack} className="p-1 -ml-1"><ArrowLeft size={19} style={{ color: COLORS.ink }} /></button>
        <h1 className="ks-display text-xl font-semibold" style={{ color: COLORS.ink }}>Digital Bill</h1>
      </div>

      {/* Admin action bar */}
      <div className="grid grid-cols-1 gap-2.5 mb-3 no-print">
        <PrimaryBtn onClick={shareLinkToWhatsApp}>
          <MessageCircle size={15} /> WhatsApp Bill Link to Customer
        </PrimaryBtn>
        <button onClick={shareLinkToWhatsAppBusiness}
          className="px-5 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
          style={{ background: "#1F5C4A", color: "#fff" }}>
          <Briefcase size={15} /> WhatsApp Business Bill Link to Customer
        </button>
        <GhostBtn onClick={shareToWhatsApp} disabled={busy}>
          <MessageCircle size={14} /> Share Bill PDF on WhatsApp instead
        </GhostBtn>
        <GhostBtn onClick={downloadPdf} disabled={busy}><Download size={14} /> Open Bill PDF (Save/Share)</GhostBtn>
      </div>
      <div className="grid grid-cols-2 gap-2.5 mb-5 no-print">
        <GhostBtn onClick={copyLink}><Copy size={14} /> Copy Bill Link</GhostBtn>
        <GhostBtn onClick={copyLink}><Link2 size={14} /> Bill ID: {r.billId}</GhostBtn>
      </div>
      <div className="rounded-lg px-3.5 py-2.5 mb-5 text-[11px] no-print ks-mono break-all" style={{ background: "#EDF6EF", color: "#2E6B45", border: "1px solid #C9E4D0" }}>
        {billLink}
      </div>

      <BillCard billId={r.billId} billDate={r.billDate} customerName={customer.name} mobile={customer.mobile}
        record={r} finalAmount={finalAmount} status={status} />
    </div>
  );
}

/* ================= OFFERS ================= */
function OffersPage({ offer, batchInfo, onSave, onResetCycle, onBack, onOpenBatch }) {
  const [title, setTitle] = useState(offer?.title || "");
  const [description, setDescription] = useState(offer?.description || "");
  const [batchSize, setBatchSize] = useState(offer?.batch_size || 30);
  const [imageUrl, setImageUrl] = useState(offer?.image_url || "");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const isNewOffer = !offer || title.trim() !== offer.title || description.trim() !== offer.description;

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErr("Image must be under 5MB"); return; }
    setUploading(true);
    setErr("");
    const url = await uploadOfferImage(file);
    if (url) setImageUrl(url); else setErr("Image upload failed — please retry");
    setUploading(false);
  };

  const save = (resetCycle) => {
    if (!title.trim()) return setErr("Offer title is required");
    if (!description.trim()) return setErr("Offer description is required");
    setErr("");
    onSave({ title, description, batchSize: Number(batchSize) || 30, imageUrl }, { resetCycle });
  };

  const rangeStart = batchInfo.total === 0 ? 0 : batchInfo.batchIndex * batchInfo.batchSize + 1;
  const rangeEnd = Math.min(batchInfo.total, rangeStart + batchInfo.list.length - 1);

  return (
    <div className="ks-rise">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-1 -ml-1"><ArrowLeft size={19} style={{ color: COLORS.ink }} /></button>
        <h1 className="ks-display text-2xl font-semibold" style={{ color: COLORS.ink }}>Offers & Broadcast</h1>
      </div>

      {offer && (
        <SectionCard className="mb-5">
          <div className="text-[11px] uppercase tracking-widest font-bold mb-3" style={{ color: COLORS.brass }}>Today's Cycle Status</div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.muted }}>Day</div>
              <div className="ks-display text-2xl font-semibold" style={{ color: COLORS.ink }}>{batchInfo.dayIdx + 1}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.muted }}>Batch</div>
              <div className="ks-display text-2xl font-semibold" style={{ color: COLORS.ink }}>{batchInfo.batchIndex + 1} <span className="text-sm" style={{ color: COLORS.muted }}>/ {batchInfo.totalBatches}</span></div>
            </div>
          </div>
          <div className="rounded-lg px-3.5 py-2.5 mb-3" style={{ background: COLORS.cream }}>
            <div className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: COLORS.brass }}>Today's Customers</div>
            <div className="text-sm" style={{ color: COLORS.ink }}>
              {batchInfo.total === 0 ? "No customers yet" : `#${rangeStart} – #${rangeEnd} of ${batchInfo.total} (${batchInfo.list.length} customers)`}
            </div>
          </div>
          <PrimaryBtn onClick={onOpenBatch} className="w-full" disabled={batchInfo.list.length === 0}>
            <Send size={15} /> Open Today's Batch ({batchInfo.list.length})
          </PrimaryBtn>
          <button onClick={onResetCycle} className="w-full mt-2.5 flex items-center justify-center gap-2 py-2 text-xs font-semibold" style={{ color: COLORS.muted }}>
            <RotateCcw size={13} /> Restart cycle from Day 1 (same offer)
          </button>
        </SectionCard>
      )}

      <FormSection label={offer ? "Edit Offer" : "Create Offer"}>
        <Field label="Offer Title" required><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Flat 20% Off on Progressive Lenses" /></Field>
        <Field label="Offer Description" required><TextArea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the offer, validity, terms…" /></Field>
        <Field label="Customers per day" hint="How many customers get this offer each day">
          <TextInput type="number" min="1" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
        </Field>
        <Field label="Offer Image" hint="Optional — shown to you while sending, and shareable alongside the WhatsApp message">
          {imageUrl && (
            <div className="relative mb-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
              <img src={imageUrl} alt="Offer" className="w-full max-h-52 object-cover" />
              <button type="button" onClick={() => setImageUrl("")}
                className="absolute top-2 right-2 rounded-full p-1.5" style={{ background: "rgba(16,16,16,0.7)" }}>
                <X size={14} style={{ color: "#fff" }} />
              </button>
            </div>
          )}
          <label className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium cursor-pointer"
            style={{ border: `1.5px dashed ${COLORS.line}`, color: COLORS.muted }}>
            <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} disabled={uploading} />
            <ImageIcon size={15} />
            {uploading ? "Uploading…" : imageUrl ? "Change Image" : "Upload Offer Image"}
          </label>
        </Field>
      </FormSection>

      {err && <p className="text-sm mb-3" style={{ color: COLORS.danger }}>{err}</p>}

      <div className="flex gap-3 mb-2">
        <PrimaryBtn className="flex-1" onClick={() => save(true)}>
          <Gift size={15} /> {offer ? "Save as New Offer (restart cycle)" : "Create Offer"}
        </PrimaryBtn>
      </div>
      {offer && (
        <GhostBtn className="w-full" onClick={() => save(false)}>
          Save Text Only (keep current cycle day)
        </GhostBtn>
      )}

      <div className="rounded-lg px-3.5 py-2.5 mt-5 text-[11px]" style={{ background: "#FBF3DD", color: "#8A6A1F", border: "1px solid #EBD9A6" }}>
        WhatsApp doesn't allow apps to send messages automatically — you'll still need to tap "Send" for each customer inside WhatsApp. This screen just lines up the right 30 people and pre-fills each message for you.
      </div>
    </div>
  );
}

function SendBatchPage({ offer, batchInfo, onBack, showToast }) {
  const [sent, setSent] = useState({});
  const [busyId, setBusyId] = useState(null);
  const markSent = (id) => setSent((s) => ({ ...s, [id]: true }));
  if (!offer) return null;

  const shareToCustomer = async (c) => {
    const text = offerWaMessage(offer, c.name);
    const link = `https://wa.me/${mobileDialDigits(c.mobile)}?text=${encodeURIComponent(text)}`;

    if (!offer.image_url) {
      window.open(link, "_blank");
      markSent(c.id);
      return;
    }

    setBusyId(c.id);
    try {
      const res = await fetch(offer.image_url);
      const blob = await res.blob();
      const file = new File([blob], "offer.jpg", { type: blob.type || "image/jpeg" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: offer.title });
        markSent(c.id);
      } else {
        window.open(link, "_blank");
        markSent(c.id);
        showToast?.("Your browser can't attach images to share — opened text message instead");
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        window.open(link, "_blank");
        markSent(c.id);
      }
    }
    setBusyId(null);
  };

  return (
    <div className="ks-rise">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="p-1 -ml-1"><ArrowLeft size={19} style={{ color: COLORS.ink }} /></button>
        <h1 className="ks-display text-xl font-semibold" style={{ color: COLORS.ink }}>Today's Batch</h1>
      </div>
      <p className="text-sm mb-5" style={{ color: COLORS.muted }}>
        Day {batchInfo.dayIdx + 1} · Batch {batchInfo.batchIndex + 1} of {batchInfo.totalBatches} · Tap each customer to share — pick WhatsApp, then that contact, then hit send.
      </p>

      <SectionCard className="mb-5">
        {offer.image_url && (
          <img src={offer.image_url} alt="Offer" className="w-full max-h-52 object-cover rounded-lg mb-3" style={{ border: `1px solid ${COLORS.line}` }} />
        )}
        <div className="text-[11px] uppercase tracking-widest font-bold mb-1" style={{ color: COLORS.brass }}>{offer.title}</div>
        <p className="text-sm" style={{ color: COLORS.ink }}>{offer.description}</p>
      </SectionCard>

      <div className="flex flex-col gap-2">
        {batchInfo.list.map((c, i) => {
          const done = !!sent[c.id];
          const busy = busyId === c.id;
          return (
            <div key={c.id} className="rounded-xl px-4 py-3.5 flex items-center justify-between"
              style={{ background: done ? COLORS.cream : COLORS.paper, border: `1px solid ${COLORS.line}` }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center rounded-full shrink-0 text-xs font-semibold" style={{ width: 28, height: 28, background: COLORS.cream, color: COLORS.brass }}>
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: COLORS.ink }}>{c.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: COLORS.muted }}>{c.mobile}</div>
                </div>
              </div>
              {done ? (
                <span className="flex items-center gap-1 text-xs font-semibold shrink-0" style={{ color: "#2E8B4F" }}><Check size={14} /> Sent</span>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => shareToCustomer(c)} disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#25D366", color: "#fff" }}>
                    {offer.image_url ? <Share2 size={13} /> : <MessageCircle size={13} />}
                    {busy ? "…" : offer.image_url ? "Share" : "Send"}
                  </button>
                  {!offer.image_url && (
                    <a href={waBusinessLink(c.mobile, offerWaMessage(offer, c.name))} onClick={() => markSent(c.id)}
                      className="flex items-center justify-center p-1.5 rounded-lg" style={{ background: "#1F5C4A", color: "#fff" }}
                      title="Send via WhatsApp Business">
                      <Briefcase size={14} />
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= SETTINGS ================= */
function SettingsPage({ customers, totalRecords, onExport, onChangePin, userEmail, onOpenOffers }) {
  return (
    <div className="ks-rise">
      <h1 className="ks-display text-2xl font-semibold mb-5" style={{ color: COLORS.ink }}>Settings</h1>

      <SectionCard className="mb-4">
        <div className="text-[11px] uppercase tracking-widest font-bold mb-3" style={{ color: COLORS.brass }}>Overview</div>
        <div className="flex justify-between text-sm mb-1.5"><span style={{ color: COLORS.muted }}>Total Customers</span><span className="font-semibold" style={{ color: COLORS.ink }}>{customers.length}</span></div>
        <div className="flex justify-between text-sm"><span style={{ color: COLORS.muted }}>Total Records</span><span className="font-semibold" style={{ color: COLORS.ink }}>{totalRecords}</span></div>
      </SectionCard>

      <button onClick={onOpenOffers} className="w-full mb-4 rounded-2xl p-5 flex items-center justify-between text-left"
        style={{ background: COLORS.ink }}>
        <div>
          <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: COLORS.brassLight }}>Marketing</div>
          <div className="ks-display text-lg font-semibold" style={{ color: COLORS.paper }}>Offers &amp; WhatsApp Broadcast</div>
          <div className="text-xs mt-1" style={{ color: "#B5B2AA" }}>Cycle daily offers to your customers</div>
        </div>
        <div className="rounded-full p-3" style={{ background: "rgba(255,255,255,0.08)" }}>
          <Gift size={20} style={{ color: COLORS.paper }} />
        </div>
      </button>

      <SectionCard className="mb-4">
        <div className="text-[11px] uppercase tracking-widest font-bold mb-1" style={{ color: COLORS.brass }}>Backup / Export</div>
        <p className="text-sm mb-3" style={{ color: COLORS.muted }}>Download every customer and their full record history as a CSV file, compatible with Excel and Google Sheets.</p>
        <PrimaryBtn onClick={onExport} className="w-full"><Download size={15} /> Export Customer Data (CSV)</PrimaryBtn>
      </SectionCard>

      <SectionCard className="mb-4">
        <div className="text-[11px] uppercase tracking-widest font-bold mb-1" style={{ color: COLORS.brass }}>Security</div>
        {userEmail && <p className="text-xs mb-2" style={{ color: COLORS.muted }}>Signed in as <span style={{ color: COLORS.ink, fontWeight: 600 }}>{userEmail}</span></p>}
        <p className="text-sm mb-3" style={{ color: COLORS.muted }}>Sign out of the owner account on this device.</p>
        <GhostBtn onClick={onChangePin} className="w-full"><LogOut size={15} /> Sign Out</GhostBtn>
      </SectionCard>

      <div className="flex items-center gap-2 justify-center pt-4">
        <User size={12} style={{ color: COLORS.muted }} />
        <span className="text-[11px]" style={{ color: COLORS.muted }}>Private app for K.S OPTICALS · Owner access only</span>
      </div>
    </div>
  );
}
