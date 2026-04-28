export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import os from 'os';

/**
 * GET /api/connect
 *
 * Returns the local network URL for mobile app connection.
 * The mobile app can scan a QR code generated from this URL,
 * or the user can type it manually.
 */
export async function GET() {
  const ip = getLocalIPv4();
  const port = process.env.MINDOS_WEB_PORT || '3456';
  const url = `http://${ip}:${port}`;

  return NextResponse.json({
    url,
    ip,
    port: Number(port),
    hostname: os.hostname(),
  });
}

/**
 * Find the first non-internal IPv4 address.
 * Prefers WiFi/Ethernet interfaces over virtual ones.
 */
function getLocalIPv4(): string {
  const interfaces = os.networkInterfaces();
  const candidates: { address: string; priority: number }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const iface of addrs || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      // Prioritize common WiFi/Ethernet interface names
      let priority = 0;
      const lower = name.toLowerCase();
      if (lower.startsWith('en') || lower.startsWith('eth') || lower.startsWith('wlan')) {
        priority = 10;
      } else if (lower.startsWith('wl') || lower.startsWith('wi')) {
        priority = 8;
      } else if (lower.includes('docker') || lower.includes('veth') || lower.includes('br-')) {
        priority = -10; // deprioritize virtual interfaces
      }

      candidates.push({ address: iface.address, priority });
    }
  }

  // Sort by priority descending, return best match
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0]?.address || '127.0.0.1';
}
