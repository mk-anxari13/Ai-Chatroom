"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, RefreshCw, CheckCircle2, AlertCircle, Database, Clock } from "lucide-react";
import type { ModelOption, UserRole } from "@/types";
import { KnowledgeBasePanel } from "@/components/knowledge-base-panel";

interface SettingsPanelProps {
  onClose: () => void;
  onModelsRefreshed: (models: ModelOption[]) => void;
  role?: UserRole | null;
  isSharedAdmin?: boolean;
}

type FetchState =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "verifying"; total: number }
  | { status: "saving" }
  | { status: "done"; verified: number; total_free: number; timestamp: string }
  | { status: "error"; message: string };

export function SettingsPanel({ onClose, onModelsRefreshed, role, isSharedAdmin = false }: SettingsPanelProps) {
  const supabase = createClient();
  const [storedModels, setStoredModels] = useState<ModelOption[]>([]);
  const [loadingStored, setLoadingStored] = useState(true);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });

  useEffect(() => {
    loadStoredModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStoredModels() {
    setLoadingStored(true);
    const { data, error } = await supabase
      .from("models")
      .select("id, name, provider, last_verified_at")
      .order("name", { ascending: true });
    if (!error && data) {
      setStoredModels(data as ModelOption[]);
    }
    setLoadingStored(false);
  }

  async function handleFetchModels() {
    setFetchState({ status: "fetching" });
    try {
      const fetchPromise = fetch("/api/models/fetch", { method: "POST" });
      const stateTimer = setTimeout(() => {
        setFetchState({ status: "verifying", total: 0 });
      }, 2000);
      const res = await fetchPromise;
      clearTimeout(stateTimer);
      setFetchState({ status: "saving" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`);
      }
      const data = await res.json() as {
        success: boolean;
        total_free: number;
        verified: number;
        models: ModelOption[];
      };
      setFetchState({
        status: "done",
        verified: data.verified,
        total_free: data.total_free,
        timestamp: new Date().toLocaleString(),
      });
      await loadStoredModels();
      onModelsRefreshed(data.models);
    } catch (err) {
      setFetchState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error occurred",
      });
    }
  }

  const isFetching =
    fetchState.status === "fetching" ||
    fetchState.status === "verifying" ||
    fetchState.status === "saving";

  const lastVerified =
    storedModels.length > 0
      ? storedModels
          .map((m) => m.last_verified_at)
          .filter(Boolean)
          .sort()
          .at(-1)
      : null;

  const byProvider = storedModels.reduce<Record<string, ModelOption[]>>((acc, m) => {
    const key = m.provider ?? "other";
    (acc[key] ??= []).push(m);
    return acc;
  }, {});

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.28)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — Fluent NavigationView detail pane */}
      <div
        className="fixed inset-y-0 right-0 z-50 w-full max-w-[520px] flex flex-col animate-fluent-slide-r"
        style={{
          background: "#FFFFFF",
          borderLeft: "1px solid #E5E5E5",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.10), -2px 0 8px rgba(0,0,0,0.06)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid #E5E5E5" }}
        >
          <div>
            <h2 className="text-base font-semibold text-[#1A1A1A]">Settings</h2>
            <p className="text-xs text-[#8A8A8A] mt-0.5">Manage models and preferences</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#F3F3F3] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-6 space-y-8">

            {/* Knowledge Base — Admin only (tenant_admin or shared_admin) */}
            {(role === "tenant_admin" || role === "shared_admin") && (
              <>
                <KnowledgeBasePanel isSharedAdmin={isSharedAdmin} />
                <div style={{ borderTop: "1px solid #E5E5E5" }} />
              </>
            )}

            {/* Model Management */}
            <section>
              <div className="flex items-center gap-2 mb-1">
                <Database className="h-4 w-4 text-[#0078D4]" />
                <h3 className="text-sm font-semibold text-[#1A1A1A]">Model Management</h3>
              </div>
              <p className="text-xs text-[#5C5C5C] mb-5 leading-relaxed">
                Fetch all available free models from OpenRouter, verify they respond correctly, and
                save them to the database. This may take up to 60 seconds.
              </p>

              {/* Stats cards — Fluent Card style */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div
                  className="rounded-xl px-4 py-3"
                  style={{ background: "#FAFAFA", border: "1px solid #E5E5E5", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
                >
                  <p className="text-[10px] text-[#8A8A8A] uppercase tracking-wider font-semibold mb-1">
                    Stored Models
                  </p>
                  <p className="text-2xl font-bold text-[#1A1A1A]">
                    {loadingStored ? (
                      <span className="text-[#C7C7C7] animate-pulse">—</span>
                    ) : storedModels.length}
                  </p>
                </div>
                <div
                  className="rounded-xl px-4 py-3"
                  style={{ background: "#FAFAFA", border: "1px solid #E5E5E5", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
                >
                  <p className="text-[10px] text-[#8A8A8A] uppercase tracking-wider font-semibold mb-1">
                    Last Verified
                  </p>
                  <p className="text-xs font-medium text-[#1A1A1A] leading-snug pt-0.5">
                    {loadingStored ? (
                      <span className="text-[#C7C7C7] animate-pulse">—</span>
                    ) : lastVerified ? (
                      new Date(lastVerified).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    ) : (
                      <span className="text-[#8A8A8A]">Never</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Fetch button */}
              <Button
                onClick={handleFetchModels}
                disabled={isFetching}
                className={`w-full h-10 text-sm font-medium rounded-xl transition-all duration-150 cursor-pointer ${
                  isFetching ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                {isFetching ? "Working..." : "Fetch OpenRouter Models"}
              </Button>

              {/* Status feedback — Fluent InfoBar style */}
              {fetchState.status !== "idle" && (
                <div
                  className="mt-3 rounded-xl px-4 py-3 text-sm transition-all duration-200"
                  style={{ border: "1px solid #E5E5E5" }}
                >
                  {fetchState.status === "fetching" && (
                    <div className="flex items-center gap-2.5 text-[#5C5C5C]">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-fluent-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0078D4]" />
                      </span>
                      <span className="text-xs">Fetching model list from OpenRouter...</span>
                    </div>
                  )}
                  {fetchState.status === "verifying" && (
                    <div className="flex items-center gap-2.5 text-[#5C5C5C]">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-fluent-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB900] opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FFB900]" />
                      </span>
                      <span className="text-xs">Verifying free models — this takes a while...</span>
                    </div>
                  )}
                  {fetchState.status === "saving" && (
                    <div className="flex items-center gap-2.5 text-[#5C5C5C]">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-fluent-ping absolute inline-flex h-full w-full rounded-full bg-[#107C10] opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#107C10]" />
                      </span>
                      <span className="text-xs">Saving verified models to database...</span>
                    </div>
                  )}
                  {fetchState.status === "done" && (
                    <div className="flex items-start gap-2.5" style={{ background: "#EFF8EF", margin: "-12px -16px", padding: "12px 16px", borderRadius: "inherit" }}>
                      <CheckCircle2 className="h-4 w-4 text-[#107C10] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-[#107C10]">
                          {fetchState.verified} models saved
                        </p>
                        <p className="text-[11px] text-[#107C10]/80 mt-0.5">
                          {fetchState.verified} verified of {fetchState.total_free} free models · {fetchState.timestamp}
                        </p>
                      </div>
                    </div>
                  )}
                  {fetchState.status === "error" && (
                    <div className="flex items-start gap-2.5" style={{ background: "#FDE7E9", margin: "-12px -16px", padding: "12px 16px", borderRadius: "inherit" }}>
                      <AlertCircle className="h-4 w-4 text-[#C42B1C] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-[#C42B1C]">Fetch failed</p>
                        <p className="text-[11px] text-[#C42B1C]/80 mt-0.5 break-words">{fetchState.message}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Stored Models List — Fluent ListView */}
            {storedModels.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#1A1A1A]">
                    Stored Models
                    <span className="ml-2 text-[11px] font-normal text-[#8A8A8A]">({storedModels.length})</span>
                  </h3>
                </div>

                <div className="space-y-4">
                  {Object.entries(byProvider)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([provider, models]) => (
                      <div key={provider}>
                        <p className="text-[10px] font-bold text-[#8A8A8A] uppercase tracking-wider mb-2">
                          {provider}
                        </p>
                        <div className="space-y-1">
                          {models.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between rounded-lg px-3 py-2.5 group
                                         transition-colors duration-100 hover:bg-[#F3F3F3]"
                              style={{ border: "1px solid #F3F3F3" }}
                            >
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-[#1A1A1A] truncate">{m.name}</p>
                                <p className="text-[11px] text-[#8A8A8A] truncate mt-0.5">{m.id}</p>
                              </div>
                              {m.last_verified_at && (
                                <div className="shrink-0 ml-3 flex items-center gap-1 text-[#8A8A8A]">
                                  <Clock className="h-3 w-3" />
                                  <span className="text-[10px]">
                                    {new Date(m.last_verified_at).toLocaleDateString()}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}

            {/* Empty state */}
            {!loadingStored && storedModels.length === 0 && (
              <div className="text-center py-10">
                <div
                  className="h-12 w-12 rounded-2xl flex items-center justify-center mx-auto mb-3"
                  style={{ background: "#F3F3F3", border: "1px solid #E5E5E5" }}
                >
                  <Database className="h-5 w-5 text-[#8A8A8A]" />
                </div>
                <p className="text-sm font-medium text-[#5C5C5C]">No models stored yet</p>
                <p className="text-xs text-[#8A8A8A] mt-1">
                  Click &quot;Fetch OpenRouter Models&quot; to populate the model list.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
