import { createContext, useContext } from 'react';

export type ToastKind = 'ok' | 'error' | 'info';

export interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const NOOP_API: ToastApi = { show: () => { /* без провайдера — no-op */ } };
export const ToastContext = createContext<ToastApi>(NOOP_API);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
