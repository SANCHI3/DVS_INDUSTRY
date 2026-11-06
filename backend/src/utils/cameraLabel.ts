/** How a camera reads wherever one line is enough: "Store aisle, Warehouse". */
export function cameraLabel(name: string, zone: string | null): string {
  return zone && zone !== name ? `${name}, ${zone}` : name;
}

/** Website names win over what the plant reports. */
export function displayedCamera(row: {
  name: string;
  zone: string | null;
  displayName?: string | null;
  displayZone?: string | null;
}): { name: string; zone: string | null } {
  return { name: row.displayName ?? row.name, zone: row.displayZone ?? row.zone };
}
