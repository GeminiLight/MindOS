export type DriverResult = { pid: number; runtime: 'node' | 'bun' } & Record<string, unknown>;

export const distDir: string;
export const driverPath: string;
export function ensureFreshDist(): void;
export function findBun(): string | null;
export function runDriver(mindRoot: string, mode: string, ...args: string[]): Promise<DriverResult>;
export function runDriverWith(execPath: string, mindRoot: string, mode: string, ...args: string[]): Promise<DriverResult>;
