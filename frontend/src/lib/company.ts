/**
 * Company contact details shown on the public site. Change them here only.
 */
export const COMPANY = {
  name: "DVS Industries",
  foundedYear: 2000,
  // The first number is the main one (footer call button).
  phones: ["+91 93263 51530", "+91 98501 90210"],
  email: "dvsindustries13@gmail.com",
  addressLines: ["Plot No B-166, MIDC Malegaon,", "Sinnar, Nashik, Maharashtra, India"],
  shortLocation: "MIDC Malegaon, Sinnar",
  region: "Nashik, Maharashtra",
  gst: "27AADFD0230G1Z2",
  // The plant's Google Maps listing "DVS INDUSTERIES" (place 0x3bddb9be29a7fde5:0xf3836ab96add1210;
  // cid is the second half in decimal). Opens the Maps app on phones, unlike a share.google link.
  mapsUrl: "https://maps.google.com/?cid=17546985917759951376",
} as const;

/** Whole years since the company was founded, e.g. 26 in 2026. */
export function yearsInBusiness(now: Date = new Date()): number {
  return now.getFullYear() - COMPANY.foundedYear;
}

/** "tel:" link for a printed phone number ("+91 98765 43210" → "tel:+919876543210"). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
