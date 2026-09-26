'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

interface AuthFormProps {
  mode: 'login' | 'signup'
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const isSignup = mode === 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [semester, setSemester] = useState('3')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const endpoint = isSignup ? '/api/users' : '/api/users/login'
      const body = isSignup
        ? { name: name.trim(), email: email.trim(), phoneNumber: phoneNumber.trim(), semester: Number(semester), password }
        : { email: email.trim(), password }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message = data?.errors?.[0]?.message || data?.message || 'Something went wrong. Please try again.'
        throw new Error(message)
      }

      router.push('/')
      router.refresh()
    } catch (submitError: any) {
      setError(submitError?.message || 'Something went wrong. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="A quiet place to study">
        <div className="auth-visual-top">
          <Link href="/" className="auth-brand">
            <span className="auth-brand-mark">P</span>
            <span>Parsea</span>
          </Link>
          <span className="auth-visual-kicker">ACADEMIC INTELLIGENCE</span>
        </div>
        <div className="auth-visual-copy">
          <p className="eyebrow">YOUR STUDY DESK</p>
          <h1>Make room for deeper learning.</h1>
          <p>Keep your semester, notes, and better questions in one calm place.</p>
        </div>
        <div className="auth-visual-caption">
          <span>01</span>
          <span>A workspace for the way you learn.</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-mobile-brand">
            <Link href="/" className="auth-brand">
              <span className="auth-brand-mark">P</span>
              <span>Parsea</span>
            </Link>
          </div>
          <div className="auth-heading">
            <p className="eyebrow">{isSignup ? 'START HERE' : 'WELCOME BACK'}</p>
            <h2>{isSignup ? 'Create your study desk.' : 'Return to your desk.'}</h2>
            <p>{isSignup ? 'Set up your student profile and make this semester easier to navigate.' : 'Sign in to pick up where you left off.'}</p>
          </div>

          <div className="auth-switcher" role="tablist" aria-label="Account access">
            <Link href="/login" className={!isSignup ? 'active' : ''}>Sign in</Link>
            <Link href="/signup" className={isSignup ? 'active' : ''}>Create account</Link>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignup && (
              <label className="auth-field">
                <span>Full name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" placeholder="Your name" />
              </label>
            )}
            <label className="auth-field">
              <span>Email address</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@college.edu" />
            </label>
            {isSignup && (
              <div className="auth-form-row">
                <label className="auth-field">
                  <span>Semester</span>
                  <select value={semester} onChange={(event) => setSemester(event.target.value)} required>
                    {Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>Semester {index + 1}</option>)}
                  </select>
                </label>
                <label className="auth-field">
                  <span>Phone <em>optional</em></span>
                  <input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} autoComplete="tel" placeholder="+91" />
                </label>
              </div>
            )}
            <label className="auth-field">
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="auth-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Opening your desk...' : isSignup ? 'Create my account' : 'Sign in'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="auth-legal">By continuing, you agree to use Parsea for learning and respectful academic collaboration.</p>
        </div>
      </section>
    </main>
  )
}
