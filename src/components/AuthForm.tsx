'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { AmbientGrid } from '@/components/AmbientGrid'
import { BrandMark } from '@/components/BrandMark'
import '@/app/(frontend)/auth.css'

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
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const endpoint = isSignup ? '/api/users' : '/api/users/login'
      const body = isSignup
        ? {
            name: name.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber.trim(),
            semester: Number(semester),
            password,
          }
        : { email: email.trim(), password }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message =
          data?.errors?.[0]?.message || data?.message || 'Something went wrong. Please try again.'
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
    <div className="auth-shell parsea-theme">
      <AmbientGrid />
      <header className="auth-topbar">
        <Link href="/" className="auth-brand">
          <BrandMark />
          <span>Parsea</span>
        </Link>
        <Link href="/" className="auth-home-link">
          Back to home <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <main className="auth-page">
        <section className="auth-visual" aria-label="A quiet place to study">
          <span className="auth-visual-kicker">A LITTLE CLARITY, EVERY DAY</span>
          <div className="auth-visual-copy">
            <h1>
              Less overwhelm.
              <br />
              <span>More understanding.</span>
            </h1>
            <p>Your notes, your questions, your own pace. Make a little room for learning.</p>
          </div>
          <div className="auth-study-preview" aria-label="Your study journey">
            <div className="auth-preview-heading">
              <BrandMark />
              <span>Small steps. Real understanding.</span>
            </div>
            <ol>
              <li>
                <span className="auth-step-number">01</span>
                <div>
                  <strong>Bring your material</strong>
                  <span>Everything you’re learning, in one place.</span>
                </div>
              </li>
              <li>
                <span className="auth-step-number">02</span>
                <div>
                  <strong>Ask the question</strong>
                  <span>There’s no such thing as a small question.</span>
                </div>
              </li>
              <li>
                <span className="auth-step-number">03</span>
                <div>
                  <strong>Find your next “got it”</strong>
                  <span>One concept clearer. One step forward.</span>
                </div>
              </li>
            </ol>
          </div>
          <div className="auth-visual-caption">
            <span aria-hidden="true">✧</span>
            <span>Big ideas. Small steps. You’ve got this.</span>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-inner">
            <div className="auth-heading">
              <p className="eyebrow">{isSignup ? 'START HERE' : 'WELCOME BACK'}</p>
              <h2>{isSignup ? 'A fresh start.' : 'Welcome back.'}</h2>
              <p>
                {isSignup
                  ? 'Set up your student profile and make this semester easier to navigate.'
                  : 'Sign in to pick up where you left off.'}
              </p>
            </div>

            <nav className="auth-switcher" aria-label="Account access">
              <Link
                href="/login"
                className={!isSignup ? 'active' : ''}
                aria-current={!isSignup ? 'page' : undefined}
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className={isSignup ? 'active' : ''}
                aria-current={isSignup ? 'page' : undefined}
              >
                Create account
              </Link>
            </nav>

            <form className="auth-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
              {isSignup && (
                <label className="auth-field">
                  <span>Full name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={isSubmitting}
                    required
                    autoComplete="name"
                    placeholder="Your name"
                  />
                </label>
              )}
              <label className="auth-field">
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isSubmitting}
                  required
                  autoComplete="email"
                  placeholder="you@college.edu"
                />
              </label>
              {isSignup && (
                <div className="auth-form-row">
                  <label className="auth-field">
                    <span>Semester</span>
                    <select
                      value={semester}
                      onChange={(event) => setSemester(event.target.value)}
                      disabled={isSubmitting}
                      required
                    >
                      {Array.from({ length: 8 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          Semester {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="auth-field">
                    <span>
                      Phone <em>optional</em>
                    </span>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(event) => setPhoneNumber(event.target.value)}
                      disabled={isSubmitting}
                      autoComplete="tel"
                      placeholder="+91"
                    />
                  </label>
                </div>
              )}
              <div className="auth-field">
                <label htmlFor="auth-password">Password</label>
                <div className="auth-password-wrap">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSubmitting}
                    required
                    minLength={8}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isSubmitting}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="auth-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Opening your desk...' : isSignup ? 'Create my account' : 'Sign in'}
                <span aria-hidden="true">→</span>
              </button>
            </form>

            <p className="auth-legal">Your space for notes, questions, and steady progress.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
