'use client'

import React, { useState } from 'react'

export default function ChatPage() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<any>(null)

  const askQuestion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question) return
    
    setLoading(true)
    setResponse(null)
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      })
      
      const data = await res.json()
      setResponse(data)
    } catch (err) {
      console.error(err)
      setResponse({ error: 'Failed to fetch answer' })
    }
    
    setLoading(false)
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 40, fontFamily: 'sans-serif' }}>
      <h1>Student Chat MVP</h1>
      <form onSubmit={askQuestion} style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input 
          type="text" 
          value={question} 
          onChange={e => setQuestion(e.target.value)} 
          placeholder="Ask a question about your study materials..." 
          style={{ flex: 1, padding: 10, fontSize: 16 }}
        />
        <button type="submit" disabled={loading} style={{ padding: '10px 20px', fontSize: 16 }}>
          {loading ? 'Asking...' : 'Ask'}
        </button>
      </form>

      {response && (
        <div style={{ padding: 20, border: '1px solid #ccc', borderRadius: 8, backgroundColor: '#f9f9f9', color: 'black' }}>
          {response.error ? (
            <p style={{ color: 'red' }}>Error: {response.error}</p>
          ) : (
            <>
              <h3>Answer:</h3>
              <p style={{ lineHeight: 1.6 }}>{response.answer}</p>
              {response.sources && response.sources.length > 0 && (
                <>
                  <h4>Sources:</h4>
                  <ul style={{ paddingLeft: 20 }}>
                    {response.sources.map((s: any, i: number) => (
                      <li key={i}>
                        📄 {s.document} — Page {s.page}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
