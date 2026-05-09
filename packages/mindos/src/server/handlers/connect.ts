import os, { type NetworkInterfaceInfo } from 'node:os';
import { json, type MindosServerResponse } from '../response.js';

export type ConnectHandlerOptions = {
  port?: string | number;
  hostname?: () => string;
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
};

export type ConnectPayload = {
  url: string;
  ip: string;
  port: number;
  hostname: string;
};

export function handleConnectGet(
  options: ConnectHandlerOptions = {},
): MindosServerResponse<ConnectPayload> {
  const portValue = options.port ?? process.env.MINDOS_WEB_PORT ?? '3456';
  const port = Number(portValue);
  const ip = getLocalIPv4(options.networkInterfaces ?? os.networkInterfaces);
  return json({
    url: `http://${ip}:${portValue}`,
    ip,
    port,
    hostname: (options.hostname ?? os.hostname)(),
  });
}

export function getLocalIPv4(
  networkInterfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]> = os.networkInterfaces,
): string {
  const candidates: { address: string; priority: number }[] = [];

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const iface of addresses || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      const lower = name.toLowerCase();
      let priority = 0;
      if (lower.startsWith('en') || lower.startsWith('eth') || lower.startsWith('wlan')) {
        priority = 10;
      } else if (lower.startsWith('wl') || lower.startsWith('wi')) {
        priority = 8;
      } else if (lower.includes('docker') || lower.includes('veth') || lower.includes('br-')) {
        priority = -10;
      }

      candidates.push({ address: iface.address, priority });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0]?.address || '127.0.0.1';
}
