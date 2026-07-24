import React, { useState, useEffect, useCallback } from 'react';
import { Activity, DollarSign, Clock, Zap, RefreshCw, Trash2, X, AlertTriangle, ShieldCheck } from 'lucide-react';

interface MetricsOverview {
  totalRequests: number;
  requests24h: number;
  totalCostUsd: number;
  cost24hUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  cacheHitRatePercent: number;
}

interface FlowBreakdown {
  requests: number;
  costUsd: number;
  avgDurationMs: number;
}

interface SlowRequest {
  role: string;
  flowType: string;
  model: string;
  durationMs: number;
  costUsd: number;
  timestamp: string;
}

interface TelemetryData {
  overview: MetricsOverview;
  flowBreakdown: Record<string, FlowBreakdown>;
  roleBreakdown: Record<string, FlowBreakdown>;
  slowRequestsBottlenecks: SlowRequest[];
}

export const DevTelemetryWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/metrics');
      if (!response.ok) {
        throw new Error(`Erro ao buscar métricas: ${response.status}`);
      }
      const json = await response.json();
      if (json?.metrics) {
        setData(json.metrics);
        setError(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Falha na conexão com o servidor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [isOpen, fetchMetrics]);

  const handleReset = async () => {
    if (!window.confirm('Deseja zerar todas as métricas acumuladas de dev?')) return;
    try {
      await fetch('/api/admin/metrics/reset', { method: 'POST' });
      fetchMetrics();
    } catch {}
  };

  const isDev = import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isDev) return null;

  const totalCost = data?.overview?.totalCostUsd ?? 0;
  const totalReqs = data?.overview?.totalRequests ?? 0;
  const cacheRate = data?.overview?.cacheHitRatePercent ?? 0;

  return (
    <>
      {/* Floating Dev Badge */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          fetchMetrics();
        }}
        style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          backgroundColor: '#18181b',
          color: '#f4f4f5',
          border: '1px solid #3f3f46',
          borderRadius: '9999px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
          transition: 'all 0.2s ease',
        }}
        title="Clique para abrir o Dashboard Dev de Telemetria e Gastos"
      >
        <Zap size={15} color="#eab308" />
        <span>Dev Telemetry: <strong>${totalCost.toFixed(4)} USD</strong> ({totalReqs} reqs)</span>
        {cacheRate > 0 && (
          <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#15803d', color: '#fff' }}>
            ⚡ {cacheRate}% cache
          </span>
        )}
      </button>

      {/* Dev Dashboard Modal */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setIsOpen(false)}
        >
          <div
            style={{
              backgroundColor: '#18181b',
              color: '#f4f4f5',
              border: '1px solid #3f3f46',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '850px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Activity size={24} color="#3b82f6" />
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Dashboard Dev de Telemetria & Gastos</h2>
                  <span style={{ fontSize: '12px', color: '#a1a1aa' }}>Monitoramento de IA em tempo real (Modo Desenvolvedor)</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={fetchMetrics}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: '#27272a',
                    color: '#f4f4f5',
                    border: '1px solid #3f3f46',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  <RefreshCw size={14} className={loading ? 'spin' : ''} />
                  Atualizar
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: '#7f1d1d',
                    color: '#fef2f2',
                    border: '1px solid #991b1b',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  <Trash2 size={14} />
                  Resetar
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {error && (
              <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: '#450a0a', color: '#fca5a5', fontSize: '13px', marginBottom: '16px' }}>
                ⚠️ {error}
              </div>
            )}

            {/* Top Stat Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              <div style={{ backgroundColor: '#27272a', padding: '14px', borderRadius: '10px', border: '1px solid #3f3f46' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>
                  <span>Custo Total Estimado</span>
                  <DollarSign size={16} color="#22c55e" />
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#4ade80' }}>
                  ${totalCost.toFixed(4)} USD
                </div>
                <span style={{ fontSize: '11px', color: '#71717a' }}>24h: ${data?.overview?.cost24hUsd ?? 0} USD</span>
              </div>

              <div style={{ backgroundColor: '#27272a', padding: '14px', borderRadius: '10px', border: '1px solid #3f3f46' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>
                  <span>Requisições Totais</span>
                  <Activity size={16} color="#3b82f6" />
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>
                  {totalReqs}
                </div>
                <span style={{ fontSize: '11px', color: '#71717a' }}>Últimas 24h: {data?.overview?.requests24h ?? 0}</span>
              </div>

              <div style={{ backgroundColor: '#27272a', padding: '14px', borderRadius: '10px', border: '1px solid #3f3f46' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>
                  <span>Economia p/ Cache</span>
                  <Zap size={16} color="#eab308" />
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#fde047' }}>
                  {cacheRate}%
                </div>
                <span style={{ fontSize: '11px', color: '#71717a' }}>{data?.overview?.totalCachedTokens?.toLocaleString() ?? 0} cached tokens</span>
              </div>

              <div style={{ backgroundColor: '#27272a', padding: '14px', borderRadius: '10px', border: '1px solid #3f3f46' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }}>
                  <span>Tokens Processados</span>
                  <Clock size={16} color="#a855f7" />
                </div>
                <div style={{ fontSize: '16px', fontWeight: 700 }}>
                  In: {((data?.overview?.totalPromptTokens ?? 0) / 1000).toFixed(1)}k
                </div>
                <span style={{ fontSize: '11px', color: '#71717a' }}>Out: {((data?.overview?.totalCompletionTokens ?? 0) / 1000).toFixed(1)}k tokens</span>
              </div>
            </div>

            {/* Breakdown por Fluxo */}
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#d4d4d8', marginBottom: '12px' }}>📊 Desempenho por Fluxo do Produto</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              {[
                { key: 'summary', title: '📄 Resumo Médico', color: '#3b82f6' },
                { key: 'quiz', title: '🎯 Simulado / Quiz', color: '#10b981' },
                { key: 'flashcards', title: '🃏 Flashcards', color: '#f59e0b' },
              ].map(({ key, title, color }) => {
                const flow = data?.flowBreakdown?.[key];
                return (
                  <div key={key} style={{ backgroundColor: '#27272a', padding: '14px', borderRadius: '8px', borderLeft: `4px solid ${color}` }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>{title}</div>
                    <div style={{ fontSize: '12px', color: '#a1a1aa', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div>Chamadas: <strong style={{ color: '#f4f4f5' }}>{flow?.requests ?? 0}</strong></div>
                      <div>Custo: <strong style={{ color: '#4ade80' }}>${flow?.costUsd ?? 0} USD</strong></div>
                      <div>Tempo Médio: <strong style={{ color: '#f4f4f5' }}>{((flow?.avgDurationMs ?? 0) / 1000).toFixed(2)}s</strong></div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Gargalos de Tempo (> 8s) */}
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#d4d4d8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={16} color="#f97316" /> Requisições Mais Lentas (Gargalos de Tempo)
            </h3>
            {data?.slowRequestsBottlenecks?.length ? (
              <div style={{ overflowX: 'auto', backgroundColor: '#27272a', borderRadius: '8px', padding: '8px' }}>
                <table style={{ width: '100%', fontSize: '12px', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>
                      <th style={{ padding: '8px' }}>Papel (Role)</th>
                      <th style={{ padding: '8px' }}>Modelo</th>
                      <th style={{ padding: '8px' }}>Duração</th>
                      <th style={{ padding: '8px' }}>Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slowRequestsBottlenecks.map((req, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #334155' }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{req.role}</td>
                        <td style={{ padding: '8px', color: '#a1a1aa' }}>{req.model}</td>
                        <td style={{ padding: '8px', color: '#f97316', fontWeight: 600 }}>{(req.durationMs / 1000).toFixed(2)}s</td>
                        <td style={{ padding: '8px', color: '#4ade80' }}>${req.costUsd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: '12px', backgroundColor: '#27272a', borderRadius: '8px', color: '#a1a1aa', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={16} color="#22c55e" /> Nenhum gargalo grave (&gt; 8s) detectado até o momento.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
