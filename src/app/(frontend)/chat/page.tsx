'use client'

import React, { useState } from 'react'
import { trpc } from '@/trpc/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

function normalizeMath(text: string): string {
  if (!text) return ''
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
}

export default function ChatPage() {
  const [question, setQuestion] = useState('')
  const askMutation = trpc.chat.ask.useMutation()

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || askMutation.isPending) return
    askMutation.mutate({ question: question.trim() })
  }

  const response = askMutation.data
  const error = askMutation.error
  const loading = askMutation.isPending

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, margin: 0, color: '#ffffff' }}>
          Parsea Academic Assistant
        </h1>
        <p style={{ margin: '8px 0 0', color: '#9ca3af', fontSize: '1rem' }}>
          Powered by tRPC, TanStack Query, Redis Caching, and Supabase pgvector.
        </p>
      </header>

      <form onSubmit={handleAsk} style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question (e.g. 'teach me pigeonhole principle')..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '12px 16px',
            fontSize: '1rem',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            outline: 'none',
            color: '#111827',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          style={{
            padding: '12px 24px',
            fontSize: '1rem',
            fontWeight: 600,
            borderRadius: 8,
            border: 'none',
            backgroundColor: loading ? '#9ca3af' : '#2563eb',
            color: '#ffffff',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          {loading ? 'Searching...' : 'Ask'}
        </button>
      </form>

      {loading && (
        <div style={{ padding: 24, borderRadius: 12, backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', textAlign: 'center', color: '#6b7280' }}>
          <div style={{ display: 'inline-block', width: 24, height: 24, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <p style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>Searching vector index & generating response via tRPC...</p>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && !loading && (
        <div style={{ color: '#b91c1c', backgroundColor: '#fef2f2', padding: 16, borderRadius: 8, border: '1px solid #fecaca' }}>
          <strong>Error:</strong> {error.message}
        </div>
      )}

      {response && !loading && (
        <div
          style={{
            padding: '24px 28px',
            borderRadius: 12,
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
            color: '#1f2937',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f3f4f6', paddingBottom: 12 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>
              Answer
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {response.cached && (
                <span style={{ fontSize: '0.75rem', fontWeight: 600, backgroundColor: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 999 }}>
                  🚀 Redis Cache
                </span>
              )}
              {response.latencyMs !== undefined && (
                <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                  ⚡ {(response.latencyMs / 1000).toFixed(2)}s
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              lineHeight: 1.7,
              fontSize: '1rem',
              overflowWrap: 'break-word',
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                h1: ({ node, ...props }) => <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '20px 0 10px', color: '#111827' }} {...props} />,
                h2: ({ node, ...props }) => <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '18px 0 8px', color: '#1f2937' }} {...props} />,
                h3: ({ node, ...props }) => <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '14px 0 6px', color: '#374151' }} {...props} />,
                p: ({ node, ...props }) => <p style={{ margin: '10px 0' }} {...props} />,
                ul: ({ node, ...props }) => <ul style={{ paddingLeft: 24, margin: '10px 0' }} {...props} />,
                ol: ({ node, ...props }) => <ol style={{ paddingLeft: 24, margin: '10px 0' }} {...props} />,
                li: ({ node, ...props }) => <li style={{ margin: '4px 0' }} {...props} />,
                blockquote: ({ node, ...props }) => (
                  <blockquote style={{ borderLeft: '4px solid #3b82f6', margin: '12px 0', padding: '8px 16px', backgroundColor: '#f0f9ff', color: '#1e40af' }} {...props} />
                ),
                code: ({ node, ...props }) => (
                  <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: '0.9em', fontFamily: 'monospace' }} {...props} />
                ),
              }}
            >
              {normalizeMath(response.answer)}
            </ReactMarkdown>
          </div>

          {response.sources && response.sources.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                📚 Sources
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {response.sources.map((s: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 8,
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>
                        📄 {s.document}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {s.chapter ? `${s.chapter} • ` : ''}<strong style={{ color: '#2563eb' }}>Page {s.page}</strong>
                      </span>
                    </div>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '6px 12px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          borderRadius: 6,
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
                          textDecoration: 'none',
                          transition: 'background-color 0.15s ease',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Open PDF ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
