import { useState } from "react";
import {
  Factory, Shield, Package, BarChart3, Users, ShoppingCart,
  CheckCircle2, MapPin, Phone, Mail, Award, Zap, Cpu, Star,
  Globe, Wrench, Eye, Layers, Send, ChevronDown, Lock, ChevronUp,
  Truck, Cog, FlaskConical, Box, GitBranch, Activity, TrendingUp,
  Building2, Car, Wind, Settings,
} from "lucide-react";

type Role = "admin" | "supplier" | "client" | "production" | "store";
interface HomePageProps { onNavigateToLogin: (role?: Role) => void; }

/* ── Growth Journey data ── */
const milestones = [
  { year: "2000", location: "C-111, Sinnar", machines: 6, manpower: 7, floor: "1,200 sq ft", material: "25 Ton/Year", note: "" },
  { year: "2004", location: "B-166, Sinnar", machines: 12, manpower: 15, floor: "4,200 sq ft", material: "60 Ton/Year", note: "" },
  { year: "2006", location: "Sai Samarth, Ambad", machines: 18, manpower: 27, floor: "6,000 sq ft", material: "110 Ton/Year", note: "" },
  { year: "2009", location: "C-137, Sinnar", machines: 23, manpower: 33, floor: "8,500 sq ft", material: "150 Ton/Year", note: "" },
  { year: "2013", location: "B-153-2/2, Sinnar", machines: 35, manpower: 48, floor: "14,000 sq ft", material: "225 Ton/Year", note: "" },
  { year: "2016", location: "C-112, Sinnar", machines: 46, manpower: 64, floor: "19,000 sq ft", material: "350 Ton/Year", note: "" },
  { year: "2018", location: "C-111, Sinnar", machines: 58, manpower: 74, floor: "24,000 sq ft", material: "550 Ton/Year", note: "" },
  { year: "2021", location: "C-112 — KVS Plastworld", machines: 66, manpower: 80, floor: "24,000 sq ft", material: "1,100 Ton/Year", note: "Export Started — Germany" },
  { year: "2024", location: "Current Plant", machines: 80, manpower: 90, floor: "30,000 sq ft", material: "2,400 Ton/Year", note: "AI Smart Factory" },
];

const capabilities = [
  { icon: Zap, label: "Laser Cutting" },
  { icon: Layers, label: "Sheet Metal Components" },
  { icon: Wrench, label: "Press Shop" },
  { icon: Cpu, label: "CNC Machining" },
  { icon: Factory, label: "Welding" },
  { icon: Box, label: "Assembly" },
  { icon: Eye, label: "Quality Inspection" },
  { icon: Package, label: "Packaging" },
  { icon: GitBranch, label: "Cold Roll Forming" },
  { icon: Cog, label: "SS Tube Manufacturing" },
];

const aiFeatures = [
  { icon: Package, title: "Real-time Inventory Intelligence", desc: "Automated stock tracking, smart reorder suggestions, and scrap analytics across all material categories." },
  { icon: Settings, title: "Predictive Maintenance", desc: "Machine health scoring, wear pattern detection, and maintenance scheduling before breakdowns occur." },
  { icon: Shield, title: "AI Security Surveillance", desc: "YOLO-based PPE compliance detection, restricted zone alerts, and crowd formation monitoring." },
];

const manufacturingFlow = [
  "Supplier", "Purchase Order", "Raw Material Received", "Warehouse",
  "Inventory", "Production Planning", "Machine Allocation", "Worker Assignment",
  "Manufacturing", "Quality Inspection", "Finished Goods", "Client Orders",
  "Dispatch", "Delivery", "Reports & AI Analytics",
];

const industries = [
  { icon: Car, label: "Automotive" },
  { icon: Wind, label: "Pump Industry" },
  { icon: Cog, label: "Engineering Industry" },
  { icon: Factory, label: "OEM Manufacturing" },
  { icon: Building2, label: "Industrial Equipment" },
  { icon: Globe, label: "Export Customers" },
];

const whyDvs = [
  { icon: Star, title: "24+ Years Experience", desc: "Founded in 2000, DVS Industries brings over two decades of precision manufacturing expertise to every project." },
  { icon: Award, title: "ISO 9001:2015 Certified", desc: "Internationally certified quality management system ensuring consistent, auditable, customer-first processes." },
  { icon: Cpu, title: "AI Powered Smart Factory", desc: "Industry 4.0-ready platform with real-time AI monitoring, predictive maintenance, and intelligent analytics." },
  { icon: Shield, title: "Trusted Manufacturing Partner", desc: "Serving automotive, pump, and engineering industries with on-time delivery and zero-defect commitment." },
];

const qualityObjectives = [
  { num: "01", label: "Reduce Customer Complaints", desc: "Zero-defect targets through robust CAPA processes." },
  { num: "02", label: "Reduce Cost of Poor Quality", desc: "Scrap reduction and rework elimination across all depts." },
  { num: "03", label: "On-Time Delivery", desc: "98%+ delivery schedule adherence across all customers." },
  { num: "04", label: "Enhance Training Activities", desc: "Structured skills development and certification programs." },
  { num: "05", label: "Improve Customer Satisfaction", desc: "Regular feedback loops and satisfaction index tracking." },
  { num: "06", label: "Improve Supplier Quality", desc: "Audit-based vendor development and delivery rating." },
  { num: "07", label: "Sustain 5S Activities", desc: "Clean, safe, and organised workplace through daily 5S." },
];

const glanceStats = [
  { label: "Established", value: "2000" },
  { label: "Machines", value: "80+" },
  { label: "Employees", value: "90+" },
  { label: "Shop Floor", value: "30,000 sq ft" },
  { label: "Material Conversion", value: "2,400 T/Y" },
  { label: "ISO Certified", value: "9001:2015" },
  { label: "Export", value: "Germany" },
];

/* ── Inquiry form ── */
function InquiryForm() {
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = "Valid email required";
    if (!form.message.trim()) e.message = "Required";
    return e;
  };
  const handleSubmit = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSubmitted(true);
  };
  const iStyle: React.CSSProperties = {
    width: "100%", padding: "0.625rem 0.875rem", border: "1px solid #D4BFBB",
    borderRadius: "0.5rem", fontSize: "0.875rem", color: "#1C1C1C", background: "#FAFAFA",
    outline: "none", transition: "border-color 0.15s",
  };
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = "#A52A2A"; e.target.style.boxShadow = "0 0 0 3px rgba(165,42,42,0.1)";
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>, hasErr?: boolean) => {
    e.target.style.borderColor = hasErr ? "#C0392B" : "#D4BFBB"; e.target.style.boxShadow = "none";
  };
  if (submitted) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "#E8F5E9" }}>
        <CheckCircle2 size={28} color="#2E7D32" />
      </div>
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.5rem" }}>Inquiry Received</h3>
      <p style={{ fontSize: "0.875rem", color: "#7A6C6A" }}>Thank you for contacting DVS Industries. Our team will respond within 24 business hours.</p>
      <button onClick={() => { setSubmitted(false); setForm({ name: "", company: "", email: "", phone: "", message: "" }); }}
        style={{ marginTop: "1.5rem", padding: "0.5rem 1.25rem", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", border: "none", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>
        Send Another Inquiry
      </button>
    </div>
  );
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Full Name *</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your full name"
            style={{ ...iStyle, borderColor: errors.name ? "#C0392B" : "#D4BFBB" }}
            onFocus={focus} onBlur={(e) => blur(e, !!errors.name)} />
          {errors.name && <p style={{ fontSize: "0.7rem", color: "#C0392B", marginTop: "0.2rem" }}>{errors.name}</p>}
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Company Name</label>
          <input value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="Organization name"
            style={iStyle} onFocus={focus} onBlur={(e) => blur(e)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Email Address *</label>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="your@email.com"
            style={{ ...iStyle, borderColor: errors.email ? "#C0392B" : "#D4BFBB" }}
            onFocus={focus} onBlur={(e) => blur(e, !!errors.email)} />
          {errors.email && <p style={{ fontSize: "0.7rem", color: "#C0392B", marginTop: "0.2rem" }}>{errors.email}</p>}
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Phone Number</label>
          <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 XXXXX XXXXX"
            style={iStyle} onFocus={focus} onBlur={(e) => blur(e)} />
        </div>
      </div>
      <div>
        <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Message / Inquiry *</label>
        <textarea value={form.message} onChange={(e) => set("message", e.target.value)} rows={4}
          placeholder="Describe your requirements, part specifications, or inquiry..."
          style={{ ...iStyle, resize: "vertical", borderColor: errors.message ? "#C0392B" : "#D4BFBB" } as React.CSSProperties}
          onFocus={focus} onBlur={(e) => blur(e, !!errors.message)} />
        {errors.message && <p style={{ fontSize: "0.7rem", color: "#C0392B", marginTop: "0.2rem" }}>{errors.message}</p>}
      </div>
      <button onClick={handleSubmit} className="flex items-center justify-center gap-2 w-full py-3 rounded-xl"
        style={{ background: "#A52A2A", color: "#fff", border: "none", fontSize: "0.9375rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(165,42,42,0.3)", transition: "all 0.15s" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#8B2222"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#A52A2A"; }}>
        <Send size={16} /> Send Inquiry
      </button>
    </div>
  );
}

/* ── Growth Journey Timeline ── */
function GrowthTimeline() {
  const [expanded, setExpanded] = useState<string | null>("2024");
  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-16 top-0 bottom-0 w-px" style={{ background: "linear-gradient(to bottom, #A52A2A, #4E342E)" }} />
      <div className="flex flex-col gap-0">
        {milestones.map((m, i) => {
          const isOpen = expanded === m.year;
          const isLast = i === milestones.length - 1;
          return (
            <div key={m.year} className="relative flex gap-6">
              {/* Year label + dot */}
              <div className="flex-shrink-0 w-32 flex items-start justify-end gap-3 pt-4">
                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: isLast ? "#A52A2A" : "#4E342E" }}>{m.year}</span>
                <div className="w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5"
                  style={{ background: isLast ? "#A52A2A" : "#fff", borderColor: isLast ? "#A52A2A" : "#4E342E", zIndex: 1 }} />
              </div>
              {/* Card */}
              <div className="flex-1 pb-5">
                <button
                  onClick={() => setExpanded(isOpen ? null : m.year)}
                  className="w-full text-left rounded-xl p-4 transition-all duration-200"
                  style={{
                    background: isOpen ? (isLast ? "#A52A2A" : "#4E342E") : "#fff",
                    border: `1px solid ${isOpen ? "transparent" : "#E8E2E0"}`,
                    boxShadow: isOpen ? "0 4px 20px rgba(0,0,0,0.12)" : "0 1px 4px rgba(0,0,0,0.04)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p style={{ fontSize: "0.9rem", fontWeight: 600, color: isOpen ? "#fff" : "#1C1C1C" }}>{m.location}</p>
                      <p style={{ fontSize: "0.775rem", color: isOpen ? "rgba(255,255,255,0.75)" : "#7A6C6A", marginTop: "0.1rem" }}>
                        {m.machines} Machines · {m.manpower} Employees · {m.floor}
                      </p>
                    </div>
                    {isOpen ? <ChevronUp size={16} color="rgba(255,255,255,0.8)" /> : <ChevronDown size={16} color="#9A8A88" />}
                  </div>
                  {isOpen && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Machines", val: m.machines },
                        { label: "Manpower", val: m.manpower },
                        { label: "Shop Floor", val: m.floor },
                        { label: "Output", val: m.material },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.12)" }}>
                          <p style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.65)", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</p>
                          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>{s.val}</p>
                        </div>
                      ))}
                      {m.note && (
                        <div className="col-span-2 sm:col-span-4 rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.15)" }}>
                          <p style={{ fontSize: "0.775rem", color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>★ {m.note}</p>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              </div>
            </div>
          );
        })}
        {/* Future */}
        <div className="relative flex gap-6">
          <div className="flex-shrink-0 w-32 flex items-start justify-end gap-3 pt-4">
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#9A8A88" }}>Future</span>
            <div className="w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5" style={{ background: "transparent", borderColor: "#9A8A88", borderStyle: "dashed" }} />
          </div>
          <div className="flex-1 pb-5">
            <div className="rounded-xl p-4" style={{ background: "linear-gradient(135deg, #F5F0EF, #FDF5F5)", border: "1.5px dashed #D4BFBB" }}>
              <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#4E342E", marginBottom: "0.5rem" }}>Future Expansion</p>
              <div className="flex flex-wrap gap-2">
                {["Industry 4.0", "AI Automation", "Digital Manufacturing", "Global Expansion", "Smart Factory"].map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full text-xs font-medium" style={{ background: "#A52A2A", color: "#fff" }}>{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   HOME PAGE
══════════════════════════════════ */
export function HomePage({ onNavigateToLogin }: HomePageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const navLinks = [
    { label: "About", id: "about" },
    { label: "Manufacturing", id: "manufacturing" },
    { label: "AI Smart Factory", id: "smart-factory" },
    { label: "Growth Journey", id: "growth" },
    { label: "Quality", id: "quality" },
    { label: "Contact", id: "contact" },
  ];

  const btnBase: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", transition: "all 0.15s" };

  return (
    <div style={{ background: "#FAFAFA", fontFamily: "'Inter', sans-serif", minHeight: "100vh" }}>

      {/* ─────────── STICKY NAV ─────────── */}
      <header className="sticky top-0 z-50"
        style={{ background: "rgba(255,255,255,0.97)", borderBottom: "1px solid #E8E2E0", boxShadow: "0 1px 12px rgba(0,0,0,0.06)", backdropFilter: "blur(8px)" }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#A52A2A" }}>
              <Factory size={18} color="#fff" />
            </div>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 800, color: "#1C1C1C", letterSpacing: "0.06em", lineHeight: 1 }}>DVS INDUSTRIES</p>
              <p style={{ fontSize: "0.55rem", color: "#A52A2A", letterSpacing: "0.08em", fontWeight: 600 }}>ISO 9001:2015 · NASHIK, INDIA</p>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden xl:flex items-center gap-0.5">
            {navLinks.map((link) => (
              <button key={link.id} onClick={() => scrollTo(link.id)}
                style={{ ...btnBase, padding: "0.5rem 0.8rem", borderRadius: "0.5rem", fontSize: "0.8375rem", color: "#4A4A4A", fontWeight: 500 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F0EF"; e.currentTarget.style.color = "#A52A2A"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#4A4A4A"; }}>
                {link.label}
              </button>
            ))}
          </nav>

          {/* ONE CTA */}
          <div className="flex items-center gap-2.5">
            <button onClick={() => onNavigateToLogin()} className="hidden sm:flex items-center gap-2"
              style={{ ...btnBase, padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "1.5px solid #E8E2E0", background: "#fff", color: "#4A4A4A", fontSize: "0.8375rem", fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#A52A2A"; e.currentTarget.style.color = "#A52A2A"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E8E2E0"; e.currentTarget.style.color = "#4A4A4A"; }}>
              <Lock size={13} /> Login
            </button>
            <button onClick={() => onNavigateToLogin()}
              style={{ ...btnBase, padding: "0.5rem 1.25rem", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", fontSize: "0.8375rem", fontWeight: 700, letterSpacing: "0.04em", boxShadow: "0 2px 10px rgba(165,42,42,0.3)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#8B2222"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#A52A2A"; }}>
              ACCESS SYSTEM
            </button>
            <button className="xl:hidden p-2 rounded-md" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{ ...btnBase, color: "#4A4A4A" }}>
              <ChevronDown size={20} style={{ transform: mobileMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="xl:hidden px-6 pb-4 flex flex-col gap-1" style={{ borderTop: "1px solid #F0ECEB" }}>
            {navLinks.map((link) => (
              <button key={link.id} onClick={() => scrollTo(link.id)}
                style={{ padding: "0.625rem 0.75rem", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: "0.9rem", color: "#4A4A4A", fontWeight: 500, borderRadius: "0.375rem" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F0EF"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>
                {link.label}
              </button>
            ))}
            <button onClick={() => onNavigateToLogin()}
              style={{ marginTop: "0.5rem", padding: "0.625rem 1rem", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", border: "none", fontSize: "0.875rem", fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}>
              ACCESS SYSTEM
            </button>
          </div>
        )}
      </header>

      {/* ─────────── HERO ─────────── */}
      <section id="home" style={{ background: "linear-gradient(135deg, #1C1410 0%, #2E1A14 40%, #4E342E 100%)", position: "relative", overflow: "hidden", minHeight: "88vh", display: "flex", alignItems: "center" }}>
        {/* Grid pattern overlay */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(165,42,42,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(165,42,42,0.06) 1px, transparent 1px)", backgroundSize: "48px 48px", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "20%", right: "5%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(165,42,42,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div className="max-w-7xl mx-auto px-6 py-20 w-full">
          <div className="max-w-3xl">
            {/* Hero content */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
                style={{ background: "rgba(165,42,42,0.25)", border: "1px solid rgba(165,42,42,0.4)" }}>
                <div className="w-2 h-2 rounded-full" style={{ background: "#A52A2A" }} />
                <span style={{ fontSize: "0.75rem", color: "#FFCDD2", fontWeight: 600, letterSpacing: "0.08em" }}>ISO 9001:2015 CERTIFIED · NASHIK, INDIA</span>
              </div>
              <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 800, color: "#FAFAFA", lineHeight: 1.15, marginBottom: "1.25rem", letterSpacing: "-0.02em" }}>
                AI-Powered Smart<br />
                <span style={{ color: "#E57373" }}>Manufacturing Platform</span>
              </h1>
              <p style={{ fontSize: "1.0625rem", color: "rgba(250,250,250,0.72)", lineHeight: 1.7, marginBottom: "2rem", maxWidth: 520 }}>
                An integrated AI-powered Industrial Monitoring and Management System enabling real-time production monitoring, smart inventory management, predictive maintenance, AI security surveillance, workforce analytics and enterprise resource planning for modern manufacturing.
              </p>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => onNavigateToLogin()}
                  style={{ ...btnBase, padding: "0.875rem 2rem", borderRadius: "0.625rem", background: "#A52A2A", color: "#fff", fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "0.04em", boxShadow: "0 4px 24px rgba(165,42,42,0.45)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#8B2222"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#A52A2A"; }}>
                  Access System
                </button>
                <button onClick={() => scrollTo("contact")}
                  style={{ ...btnBase, padding: "0.875rem 1.75rem", borderRadius: "0.625rem", background: "rgba(255,255,255,0.08)", color: "#FAFAFA", fontSize: "0.9375rem", fontWeight: 600, border: "1.5px solid rgba(255,255,255,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}>
                  Contact Us
                </button>
              </div>
              {/* Trust strip */}
              <div className="flex flex-wrap gap-6 mt-8">
                {[["80+", "Machines"], ["90+", "Employees"], ["24+", "Years"], ["2,400 T", "Annual Output"]].map(([v, l]) => (
                  <div key={l}>
                    <p style={{ fontSize: "1.25rem", fontWeight: 800, color: "#fff" }}>{v}</p>
                    <p style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── ABOUT ─────────── */}
      <section id="about" style={{ background: "#fff", padding: "5rem 1.5rem" }}>
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>About DVS Industries</p>
              <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 800, color: "#1C1C1C", lineHeight: 1.2, marginBottom: "1.25rem" }}>
                Precision Manufacturing<br />Under One Roof
              </h2>
              <p style={{ fontSize: "1rem", color: "#4A4A4A", lineHeight: 1.75, marginBottom: "1rem" }}>
                DVS Industries is an <strong>ISO 9001:2015 certified</strong> manufacturer specializing in precision sheet metal components, welded assemblies, machined parts, cold roll products and stainless steel tube manufacturing under one roof.
              </p>
              <p style={{ fontSize: "1rem", color: "#4A4A4A", lineHeight: 1.75, marginBottom: "2rem" }}>
                Serving automotive, pump and engineering industries with continuous improvement, quality manufacturing and customer-focused innovation since 2000.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {([["Plot B-166, MIDC Malegaon,\nSinnar, Nashik, Maharashtra", MapPin], ["GST: 27AADFD0230G1Z2\nISO 9001:2015 Certified", Award]] as const).map(([text, Icon], i) => (
                  <div key={i} className="flex gap-3 p-4 rounded-xl" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
                    <Icon size={20} color="#A52A2A" className="flex-shrink-0 mt-0.5" />
                    <p style={{ fontSize: "0.8rem", color: "#4A4A4A", lineHeight: 1.6, whiteSpace: "pre-line" }}>{text}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Vision & Mission cards */}
            <div className="flex flex-col gap-5">
              <div className="rounded-2xl p-7" style={{ background: "linear-gradient(135deg, #A52A2A, #7B1F1F)", boxShadow: "0 8px 32px rgba(165,42,42,0.25)" }}>
                <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.625rem" }}>Our Vision</p>
                <p style={{ fontSize: "1rem", color: "#fff", lineHeight: 1.7 }}>
                  Growth of business through continual improvement in all operational areas by empowering employees, developing new products, expanding customers and achieving <strong>annual sales growth of 35%.</strong>
                </p>
              </div>
              <div className="rounded-2xl p-7" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.625rem" }}>Our Mission</p>
                <p style={{ fontSize: "1rem", color: "#4A4A4A", lineHeight: 1.7 }}>
                  Manufacture precision press parts, welded assemblies, machined parts, cold roll products and stainless steel tube components under one roof through <strong>Kaizen and continual improvement</strong> for automotive, pump and engineering industries.
                </p>
              </div>
              {/* Core Values */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Award, title: "Commitment", desc: "100% customer satisfaction through prompt, reliable service." },
                  { icon: Globe, title: "Transparency", desc: "Open communication with customers, suppliers and employees." },
                  { icon: Shield, title: "Safety", desc: "Safety is our highest operational priority — zero compromise." },
                ].map((v) => (
                  <div key={v.title} className="rounded-xl p-4 text-center" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
                    <v.icon size={22} color="#A52A2A" style={{ margin: "0 auto 0.5rem" }} />
                    <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.3rem" }}>{v.title}</p>
                    <p style={{ fontSize: "0.72rem", color: "#7A6C6A", lineHeight: 1.5 }}>{v.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── MANUFACTURING CAPABILITIES ─────────── */}
      <section id="manufacturing" style={{ background: "#F9F6F5", padding: "5rem 1.5rem" }}>
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Manufacturing Capabilities</p>
            <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 800, color: "#1C1C1C" }}>End-to-End Manufacturing</h2>
            <p style={{ fontSize: "1rem", color: "#7A6C6A", marginTop: "0.75rem" }}>Complete manufacturing capabilities from raw material to finished, packaged product.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {capabilities.map((cap) => (
              <div key={cap.label} className="flex flex-col items-center text-center p-5 rounded-xl transition-all duration-200"
                style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#A52A2A"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(165,42,42,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E8E2E0"; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 6px rgba(0,0,0,0.04)"; }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "#FDF5F5" }}>
                  <cap.icon size={22} color="#A52A2A" />
                </div>
                <p style={{ fontSize: "0.8375rem", fontWeight: 600, color: "#1C1C1C" }}>{cap.label}</p>
              </div>
            ))}
          </div>

          {/* Industries We Serve */}
          <div className="mt-16">
            <div className="text-center mb-8">
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>Industries We Serve</p>
              <h3 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1C1C1C" }}>Trusted Across Industries</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {industries.map((ind) => (
                <div key={ind.label} className="flex flex-col items-center text-center p-4 rounded-xl"
                  style={{ background: "#fff", border: "1px solid #E8E2E0" }}>
                  <ind.icon size={28} color="#4E342E" style={{ marginBottom: "0.5rem" }} />
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1C1C1C" }}>{ind.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── AI SMART FACTORY ─────────── */}
      <section id="smart-factory" style={{ background: "linear-gradient(135deg, #1C1410 0%, #2E1A14 60%, #3E2820 100%)", padding: "5rem 1.5rem", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(165,42,42,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(165,42,42,0.05) 1px, transparent 1px)", backgroundSize: "48px 48px", pointerEvents: "none" }} />
        <div className="max-w-7xl mx-auto relative">
          <div className="text-center mb-12">
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#E57373", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>AI Smart Factory</p>
            <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 800, color: "#FAFAFA" }}>Intelligence Built Into Every Process</h2>
            <p style={{ fontSize: "1rem", color: "rgba(250,250,250,0.65)", marginTop: "0.75rem" }}>Real-time AI monitoring, predictive analytics, and smart automation across the entire factory floor.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-14">
            {aiFeatures.map((f) => (
              <div key={f.title} className="rounded-2xl p-6 transition-all duration-200"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(8px)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(165,42,42,0.2)"; e.currentTarget.style.borderColor = "rgba(165,42,42,0.4)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(165,42,42,0.3)" }}>
                  <f.icon size={22} color="#E57373" />
                </div>
                <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#FAFAFA", marginBottom: "0.5rem" }}>{f.title}</h3>
                <p style={{ fontSize: "0.8rem", color: "rgba(250,250,250,0.65)", lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Manufacturing Flow */}
          <div className="rounded-2xl p-8" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#E57373", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Complete Manufacturing Flow</p>
            <div className="flex flex-wrap items-center gap-2">
              {manufacturingFlow.map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <div className="px-3 py-1.5 rounded-lg"
                    style={{
                      background: i === 0 ? "rgba(165,42,42,0.4)" : i === manufacturingFlow.length - 1 ? "rgba(46,125,50,0.4)" : "rgba(255,255,255,0.08)",
                      border: `1px solid ${i === 0 ? "rgba(165,42,42,0.5)" : i === manufacturingFlow.length - 1 ? "rgba(46,125,50,0.5)" : "rgba(255,255,255,0.12)"}`,
                    }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#FAFAFA", whiteSpace: "nowrap" }}>{step}</span>
                  </div>
                  {i < manufacturingFlow.length - 1 && (
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.875rem" }}>→</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── GROWTH JOURNEY ─────────── */}
      <section id="growth" style={{ background: "#fff", padding: "5rem 1.5rem" }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Our Growth Journey</p>
            <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 800, color: "#1C1C1C" }}>24 Years of Continuous Growth</h2>
            <p style={{ fontSize: "1rem", color: "#7A6C6A", marginTop: "0.75rem" }}>From a 6-machine, 1,200 sq ft workshop to a 30,000 sq ft AI-powered smart factory. Click any milestone to expand.</p>
          </div>
          <GrowthTimeline />

          {/* Company at a Glance */}
          <div className="mt-16">
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#1C1C1C", textAlign: "center", marginBottom: "1.5rem" }}>Company at a Glance</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
              {glanceStats.map((s) => (
                <div key={s.label} className="text-center p-4 rounded-xl" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
                  <p style={{ fontSize: "1.125rem", fontWeight: 800, color: "#A52A2A" }}>{s.value}</p>
                  <p style={{ fontSize: "0.7rem", color: "#7A6C6A", marginTop: "0.2rem", lineHeight: 1.4 }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── QUALITY OBJECTIVES ─────────── */}
      <section id="quality" style={{ background: "#F9F6F5", padding: "5rem 1.5rem" }}>
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Quality Management</p>
            <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 800, color: "#1C1C1C" }}>Quality Objectives</h2>
            <p style={{ fontSize: "1rem", color: "#7A6C6A", marginTop: "0.75rem" }}>Our ISO 9001:2015 certified quality management system drives measurable improvement across every function.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
            {qualityObjectives.map((q) => (
              <div key={q.num} className="p-5 rounded-xl" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
                <p style={{ fontSize: "2rem", fontWeight: 800, color: "#E8E2E0", lineHeight: 1, marginBottom: "0.625rem" }}>{q.num}</p>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.375rem" }}>{q.label}</h3>
                <p style={{ fontSize: "0.775rem", color: "#7A6C6A", lineHeight: 1.5 }}>{q.desc}</p>
              </div>
            ))}
          </div>

          {/* Why DVS */}
          <div className="mt-4">
            <h3 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1C1C1C", textAlign: "center", marginBottom: "2rem" }}>Why Choose DVS Industries</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {whyDvs.map((w) => (
                <div key={w.title} className="p-6 rounded-2xl text-center transition-all duration-200"
                  style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#A52A2A"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(165,42,42,0.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E8E2E0"; e.currentTarget.style.boxShadow = "0 1px 6px rgba(0,0,0,0.04)"; }}>
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "#FDF5F5" }}>
                    <w.icon size={26} color="#A52A2A" />
                  </div>
                  <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.5rem" }}>{w.title}</h3>
                  <p style={{ fontSize: "0.8rem", color: "#7A6C6A", lineHeight: 1.6 }}>{w.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── CONTACT ─────────── */}
      <section id="contact" style={{ background: "#fff", padding: "5rem 1.5rem" }}>
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Get In Touch</p>
            <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.25rem)", fontWeight: 800, color: "#1C1C1C" }}>Contact DVS Industries</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Contact info */}
            <div className="flex flex-col gap-5">
              <div className="p-6 rounded-2xl" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "1rem" }}>Plant — 1</h3>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <MapPin size={18} color="#A52A2A" className="flex-shrink-0 mt-0.5" />
                    <p style={{ fontSize: "0.875rem", color: "#4A4A4A", lineHeight: 1.6 }}>Plot No B-166, MIDC Malegaon,<br />Sinnar, Nashik, Maharashtra, India</p>
                  </div>
                  <div className="flex gap-3">
                    <Phone size={18} color="#A52A2A" className="flex-shrink-0" />
                    <p style={{ fontSize: "0.875rem", color: "#4A4A4A" }}>+91 XXXXX XXXXX</p>
                  </div>
                  <div className="flex gap-3">
                    <Mail size={18} color="#A52A2A" className="flex-shrink-0" />
                    <p style={{ fontSize: "0.875rem", color: "#4A4A4A" }}>info@dvsindustries.com</p>
                  </div>
                  <div className="flex gap-3">
                    <Award size={18} color="#A52A2A" className="flex-shrink-0" />
                    <p style={{ fontSize: "0.875rem", color: "#4A4A4A" }}>GST: 27AADFD0230G1Z2</p>
                  </div>
                </div>
              </div>
              {/* Map placeholder */}
              <div className="rounded-2xl overflow-hidden flex items-center justify-center" style={{ height: 220, background: "linear-gradient(135deg, #F5F0EF, #EDE0DB)", border: "1px solid #E8E2E0" }}>
                <div className="text-center">
                  <MapPin size={32} color="#A52A2A" style={{ margin: "0 auto 0.5rem" }} />
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#4E342E" }}>MIDC Malegaon, Sinnar</p>
                  <p style={{ fontSize: "0.775rem", color: "#9A8A88" }}>Nashik, Maharashtra</p>
                  <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-block", marginTop: "0.75rem", fontSize: "0.775rem", color: "#A52A2A", fontWeight: 600, textDecoration: "none" }}>
                    Open in Google Maps →
                  </a>
                </div>
              </div>
            </div>
            {/* Inquiry form */}
            <div className="p-8 rounded-2xl" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "1.5rem" }}>Send an Inquiry</h3>
              <InquiryForm />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── FOOTER ─────────── */}
      <footer style={{ background: "linear-gradient(135deg, #1C1410, #2E1A14)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-7xl mx-auto px-6 py-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "#A52A2A" }}>
                  <Factory size={16} color="#fff" />
                </div>
                <div>
                  <p style={{ fontSize: "0.8rem", fontWeight: 800, color: "#fff", letterSpacing: "0.05em" }}>DVS INDUSTRIES</p>
                  <p style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em" }}>ISO 9001:2015 CERTIFIED</p>
                </div>
              </div>
              <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.7, marginBottom: "1rem" }}>
                Manufacturers of Precision Sheet Metal Components & Welded Assemblies.<br />Nashik, Maharashtra, India.
              </p>
              <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)" }}>GST: 27AADFD0230G1Z2</p>
            </div>

            {/* Quick Links */}
            <div>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Quick Links</p>
              {["About", "Manufacturing", "AI Smart Factory", "Growth Journey", "Quality", "Contact"].map((link) => (
                <button key={link} onClick={() => scrollTo(link.toLowerCase().replace(" ", "-"))}
                  style={{ display: "block", background: "none", border: "none", cursor: "pointer", padding: "0.25rem 0", fontSize: "0.8375rem", color: "rgba(255,255,255,0.6)", textAlign: "left", transition: "color 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#E57373"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
                  {link}
                </button>
              ))}
            </div>

            {/* Capabilities */}
            <div>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Manufacturing</p>
              {["Laser Cutting", "Sheet Metal", "Press Shop", "CNC Machining", "Welding", "Assembly"].map((s) => (
                <p key={s} style={{ fontSize: "0.8375rem", color: "rgba(255,255,255,0.6)", padding: "0.25rem 0" }}>{s}</p>
              ))}
            </div>

            {/* ERP Access */}
            <div>
              <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>ERP Access</p>
              {([
                ["admin", "Administrator"],
                ["production", "Production"],
                ["quality", "Quality"],
                ["store", "Store"],
                ["supplier", "Supplier Portal"],
                ["client", "Client Portal"],
              ] as [Role, string][]).map(([role, label]) => (
                <button key={role} onClick={() => onNavigateToLogin(role)}
                  style={{ display: "block", background: "none", border: "none", cursor: "pointer", padding: "0.25rem 0", fontSize: "0.8375rem", color: "rgba(255,255,255,0.6)", textAlign: "left", transition: "color 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#E57373"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <p style={{ fontSize: "0.775rem", color: "rgba(255,255,255,0.35)" }}>© 2024 DVS Industries. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <p style={{ fontSize: "0.775rem", color: "rgba(255,255,255,0.35)" }}>Powered by AI Smart Factory Platform</p>
              <div className="flex gap-2.5">
                {[Globe, Mail, Phone].map((Icon, i) => (
                  <div key={i} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.07)", cursor: "pointer" }}>
                    <Icon size={14} color="rgba(255,255,255,0.5)" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
