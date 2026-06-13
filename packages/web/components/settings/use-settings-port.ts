import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  EMPTY_PORT_STATUS,
  type CheckPortResult,
  type PortStatus,
  checkingPortStatus,
  invalidPortStatus,
  isPortUnavailable,
  isValidUserPort,
  parsePortInput,
} from './settings-port';

export function useSettingsPort() {
  const [origPort, setOrigPort] = useState<number>(0);
  const [port, setPort] = useState<number>(0);
  const [status, setStatus] = useState<PortStatus>(EMPTY_PORT_STATUS);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const checkRequestRef = useRef(0);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const hasChanges = port !== origPort;
  const portInvalid = !isValidUserPort(port);
  const portUnavailable = isPortUnavailable(status);

  const resetPortStatus = useCallback(() => {
    checkRequestRef.current += 1;
    setStatus(EMPTY_PORT_STATUS);
  }, []);

  const setResolvedPort = useCallback((nextPort: number) => {
    setOrigPort(nextPort);
    setPort(nextPort);
    resetPortStatus();
  }, [resetPortStatus]);

  const checkPort = useCallback(async (nextPort: number) => {
    const requestId = ++checkRequestRef.current;
    if (!isValidUserPort(nextPort)) {
      setStatus(invalidPortStatus());
      return;
    }
    setStatus(checkingPortStatus());
    try {
      const res = await apiFetch<CheckPortResult>('/api/setup/check-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: nextPort }),
      });
      if (requestId !== checkRequestRef.current) return;
      setStatus({
        checking: false,
        available: res.available,
        isSelf: res.isSelf ?? false,
        suggestion: res.suggestion ?? null,
      });
    } catch {
      if (requestId === checkRequestRef.current) setStatus(EMPTY_PORT_STATUS);
    }
  }, []);

  const handlePortInputChange = useCallback((value: string) => {
    const nextPort = parsePortInput(value, port);
    setPort(nextPort);
    resetPortStatus();
    clearTimeout(timerRef.current);
    if (isValidUserPort(nextPort)) {
      timerRef.current = setTimeout(() => checkPort(nextPort), 500);
    }
  }, [checkPort, port, resetPortStatus]);

  const handlePortInputBlur = useCallback(() => {
    clearTimeout(timerRef.current);
    if (isValidUserPort(port)) checkPort(port);
  }, [checkPort, port]);

  const applySuggestedPort = useCallback((suggestion: number) => {
    setPort(suggestion);
    resetPortStatus();
    void checkPort(suggestion);
  }, [checkPort, resetPortStatus]);

  return {
    origPort,
    port,
    status,
    setStatus,
    setResolvedPort,
    hasChanges,
    portInvalid,
    portUnavailable,
    handlePortInputChange,
    handlePortInputBlur,
    applySuggestedPort,
  };
}
