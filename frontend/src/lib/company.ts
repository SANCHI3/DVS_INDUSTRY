/**
 * Company contact details shown on the public site. Change them here only.
 */
export const COMPANY = {
  name: "DVS Industries",
  foundedYear: 2000,
  // TODO(owner): main phone number, e.g. "+91 98765 43210". While empty, the phone row and icon are hidden.
  phone: "",
  // TODO(owner): confirm this inbox exists (staff logins use @dvsindustry.com).
  email: "info@dvsindustries.com",
  addressLines: ["Plot No B-166, MIDC Malegaon,", "Sinnar, Nashik, Maharashtra, India"],
  shortLocation: "MIDC Malegaon, Sinnar",
  region: "Nashik, Maharashtra",
  gst: "27AADFD0230G1Z2",
  // TODO(owner): replace with the plant's own Google Maps share link. This searches for the address meanwhile.
  mapsUrl:
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("Plot B-166, MIDC Malegaon, Sinnar, Nashik, Maharashtra, India"),
} as const;

/** Whole years since the company was founded, e.g. 26 in 2026. */
export function yearsInBusiness(now: Date = new Date()): number {
  return now.getFullYear() - COMPANY.foundedYear;
}

/** "tel:" link for a printed phone number ("+91 98765 43210" → "tel:+919876543210"). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
