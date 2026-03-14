const noColor = 'NO_COLOR' in process.env;
const forceColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0';
export const isTTY  = noColor ? false : (forceColor || process.stdout.isTTY);
export const bold   = (s) => isTTY ? `\x1b[1m${s}\x1b[0m`  : s;
export const dim    = (s) => isTTY ? `\x1b[2m${s}\x1b[0m`  : s;
export const cyan   = (s) => isTTY ? `\x1b[36m${s}\x1b[0m` : s;
export const green  = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
export const red    = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
export const yellow = (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;
