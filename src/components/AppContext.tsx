import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

interface AppContextValue {
  /** Open the shared activity side panel for an activity or milestone id. */
  openPanel: (id: string) => void;
  closePanel: () => void;
  panelId: string | null;
  notify: (message: string, tone?: "info" | "error") => void;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [panelId, setPanelId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const notify = useCallback((message: string, tone: "info" | "error" = "info") => {
    const id = next.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);

  const value = useMemo(
    () => ({ openPanel: setPanelId, closePanel: () => setPanelId(null), panelId, notify }),
    [panelId, notify],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 bottom-4 z-[70] flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto max-w-sm rounded-card border px-3 py-2 text-sm shadow-lg",
              t.tone === "error" ? "border-red/40 bg-red-soft text-red" : "border-line bg-surface text-ink",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
