'use client'

import React, { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { AccountMenu } from '@/components/AccountMenu'
import { AmbientGrid } from '@/components/AmbientGrid'
import { BrandMark } from '@/components/BrandMark'
import './chat.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

interface SourceCitation {
  document: string
  chapter?: string
  page: number
  url: string
}

interface CitedImage {
  url: string
  caption: string
  page: number
  document: string
}

interface ConversationSummary {
  id: string | number
  title: string
  subject?: string
  semester?: number
  messages?: ChatMessageItem[]
  lastMessageAt?: string
}

interface ChatUser {
  id: string | number
  name?: string
  email?: string
}

interface ChatMessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode?: 'quick' | 'deep'
  sources?: SourceCitation[]
  images?: CitedImage[]
  cached?: boolean
  retrievalBypassed?: boolean
  latencyMs?: number
  timestamp: number
}

const GUEST_CONVERSATIONS_KEY = 'parsea_guest_conversations'
const GUEST_ACTIVE_CONVERSATION_KEY = 'parsea_guest_active_conversation_id'
const MAX_GUEST_CONVERSATIONS = 40

function readGuestConversations(): ConversationSummary[] {
  try {
    const value = localStorage.getItem(GUEST_CONVERSATIONS_KEY)
    const conversations = value ? JSON.parse(value) : []
    return Array.isArray(conversations) ? conversations : []
  } catch {
    return []
  }
}

function normalizeMath(text: string): string {
  if (!text) return ''
  return (
    text
      // \[ ... \] → $$ ... $$ (display math)
      .replace(/\\\[([^]*?)\\\]/g, (_, m) => `$$${m}$$`)
      // \( ... \) → $ ... $ (inline math)
      .replace(/\\\(([^]*?)\\\)/g, (_, m) => `$${m}$`)
      // Unicode floor/ceiling brackets → LaTeX
      .replace(/⌊([^⌋]+)⌋/g, (_, m) => `$\\lfloor ${m} \\rfloor$`)
      .replace(/⌈([^⌉]+)⌉/g, (_, m) => `$\\lceil ${m} \\rceil$`)
  )
}

const QUICK_FOLLOW_UPS = [
  'Explain with a concrete example',
  'Simplify this in easy terms',
  'Give 3 exam practice questions',
  'Summarise key takeaways in a table',
]

const VOICE_OPTIONS = [
  { id: 'auto', label: 'auto: Dynamic Detection (Hindi / English)' },
  { id: 'hi-IN-SwaraNeural', label: 'hi-IN-SwaraNeural: Hindi (India) - Female (Swara)' },
  { id: 'hi-IN-MadhurNeural', label: 'hi-IN-MadhurNeural: Hindi (India) - Male (Madhur)' },
  { id: 'en-IN-NeerjaNeural', label: 'en-IN-NeerjaNeural: English (India) - Female (Neerja)' },
  { id: 'en-IN-PrabhatNeural', label: 'en-IN-PrabhatNeural: English (India) - Male (Prabhat)' },
  { id: 'en-US-JennyNeural', label: 'en-US-JennyNeural: English (US) - Female (Jenny)' },
]

const LANG_OPTIONS: { id: 'auto' | 'en' | 'hi'; label: string; shortLabel: string }[] = [
  { id: 'auto', label: 'Auto Detect (Matches input language)', shortLabel: 'Lang: Auto' },
  { id: 'en', label: 'English (EN) - Forces English response', shortLabel: 'EN' },
  { id: 'hi', label: 'Hindi (HI) - Forces Hindi response', shortLabel: 'HI' },
]

const STARTERS = [
  'Explain pigeonhole principle with theorem statement',
  'What is the difference between relation and function?',
  'State Bayes theorem with applications',
]

function ChatWorkspace() {
  const searchParams = useSearchParams()
  const [conversationId, setConversationId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [inputQuestion, setInputQuestion] = useState('')
  const [branch, setBranch] = useState('COMPS')
  const [semester, setSemester] = useState<number | ''>(3)
  const [subject, setSubject] = useState('Discrete Mathematics')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [chatUser, setChatUser] = useState<ChatUser | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [showComposerSettings, setShowComposerSettings] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historySearch, setHistorySearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [isCompact, setIsCompact] = useState(false)
  const [showLatest, setShowLatest] = useState(false)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const zoomRef = useRef<HTMLDivElement | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const shouldFollowRef = useRef(true)

  // Dual-Mode State
  const [chatMode, setChatMode] = useState<'quick' | 'deep'>('quick')

  // Popover UI State
  const [showModelPopover, setShowModelPopover] = useState(false)
  const [showVoicePopover, setShowVoicePopover] = useState(false)
  const [showLangPopover, setShowLangPopover] = useState(false)

  const modelPopoverRef = useRef<HTMLDivElement | null>(null)
  const voicePopoverRef = useRef<HTMLDivElement | null>(null)
  const langPopoverRef = useRef<HTMLDivElement | null>(null)

  // Language & Voice States
  const [outputLanguage, setOutputLanguage] = useState<'auto' | 'en' | 'hi'>('auto')
  const [selectedVoice, setSelectedVoice] = useState<string>('auto')
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true)
  const [conversationMode, setConversationMode] = useState<boolean>(false)
  const [isAudioQueuePlaying, setIsAudioQueuePlaying] = useState<boolean>(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const [loadingTTSId, setLoadingTTSId] = useState<string | null>(null)
  const [audioTime, setAudioTime] = useState<{ current: number; duration: number }>({
    current: 0,
    duration: 0,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const voiceActivityFrameRef = useRef<number | null>(null)
  const silenceStartedAtRef = useRef<number | null>(null)
  const heardSpeechRef = useRef(false)
  const conversationModeRef = useRef(false)

  // Audio Queue & Sentence Buffer Refs
  const audioQueueRef = useRef<string[]>([])
  const isPlayingRef = useRef<boolean>(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const sentenceBufferRef = useRef<string>('')
  const autoSpeakRef = useRef<boolean>(true)
  const selectedVoiceRef = useRef<string>('auto')
  const outputLanguageRef = useRef<'auto' | 'en' | 'hi'>('auto')
  const abortControllerRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = composerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      mainRef.current?.style.setProperty('--chat-composer-height', `${element.offsetHeight}px`)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const savedVoice = localStorage.getItem('parsea_voice')
    if (savedVoice) setSelectedVoice(savedVoice)

    const savedAuto = localStorage.getItem('parsea_auto_speak')
    if (savedAuto !== null) setAutoSpeak(savedAuto === 'true')

    const savedConversationMode = localStorage.getItem('parsea_conversation_mode')
    if (savedConversationMode !== null) setConversationMode(savedConversationMode === 'true')

    const savedMode = localStorage.getItem('parsea_mode') as 'quick' | 'deep' | null
    if (savedMode === 'quick' || savedMode === 'deep') setChatMode(savedMode)

    const savedLang = localStorage.getItem('parsea_output_lang') as 'auto' | 'en' | 'hi' | null
    if (savedLang === 'auto' || savedLang === 'en' || savedLang === 'hi')
      setOutputLanguage(savedLang)
  }, [])

  useEffect(() => {
    // PDF selection transfers locally, never through a URL or auto-submission.
    try {
      const raw = sessionStorage.getItem('parsea_pdf_draft')
      if (!raw) return
      sessionStorage.removeItem('parsea_pdf_draft')
      const draft = JSON.parse(raw)
      if (typeof draft.question === 'string') {
        setInputQuestion(draft.question.slice(0, 5000))
        setChatMode('deep')
      }
    } catch {
      /* An unavailable browser store must not break normal chat. */
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelPopoverRef.current && !modelPopoverRef.current.contains(event.target as Node)) {
        setShowModelPopover(false)
      }
      if (voicePopoverRef.current && !voicePopoverRef.current.contains(event.target as Node)) {
        setShowVoicePopover(false)
      }
      if (langPopoverRef.current && !langPopoverRef.current.contains(event.target as Node)) {
        setShowLangPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showModelPopover) modelPopoverRef.current?.querySelector('button')?.focus()
      if (showVoicePopover) voicePopoverRef.current?.querySelector('button')?.focus()
      if (showLangPopover) langPopoverRef.current?.querySelector('button')?.focus()
      setShowModelPopover(false)
      setShowVoicePopover(false)
      setShowLangPopover(false)
      if (!showModelPopover && !showVoicePopover && !showLangPopover && showComposerSettings) {
        setShowComposerSettings(false)
        document.querySelector<HTMLButtonElement>('[aria-label="Chat settings"]')?.focus()
      }
      if (showFilters) {
        setShowFilters(false)
        document.querySelector<HTMLButtonElement>('[aria-label="Edit study scope"]')?.focus()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showModelPopover, showVoicePopover, showLangPopover, showComposerSettings, showFilters])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 920px)')
    const sync = () => setIsCompact(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const sidebarIsDrawer = isCompact || focusMode
  useDialogFocus(historyOpen && sidebarIsDrawer, sidebarRef, () => setHistoryOpen(false))
  useDialogFocus(Boolean(selectedImage), zoomRef, () => setSelectedImage(null))

  useEffect(() => {
    const selectedSubject = searchParams.get('subject')
    const selectedBranch = searchParams.get('branch')
    const selectedSemester = Number(searchParams.get('sem'))
    if (selectedSubject) setSubject(selectedSubject.slice(0, 200))
    if (selectedBranch) setBranch(selectedBranch.slice(0, 200))
    if (selectedSemester >= 1 && selectedSemester <= 8 && Number.isInteger(selectedSemester))
      setSemester(selectedSemester)
    if (searchParams.get('mode') === 'deep') setChatMode('deep')
  }, [searchParams])

  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`
  }, [inputQuestion])

  useEffect(() => {
    autoSpeakRef.current = autoSpeak
    localStorage.setItem('parsea_auto_speak', String(autoSpeak))
  }, [autoSpeak])

  useEffect(() => {
    conversationModeRef.current = conversationMode
    localStorage.setItem('parsea_conversation_mode', String(conversationMode))
  }, [conversationMode])

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice
  }, [selectedVoice])

  useEffect(() => {
    outputLanguageRef.current = outputLanguage
  }, [outputLanguage])

  const handleVoiceChange = (v: string) => {
    setSelectedVoice(v)
    localStorage.setItem('parsea_voice', v)
  }

  const handleModeChange = (mode: 'quick' | 'deep') => {
    setChatMode(mode)
    localStorage.setItem('parsea_mode', mode)
  }

  const handleLanguageChange = (lang: 'auto' | 'en' | 'hi') => {
    setOutputLanguage(lang)
    localStorage.setItem('parsea_output_lang', lang)
  }

  // Function to play queued audio chunks sequentially
  const playNextInQueue = () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      setIsAudioQueuePlaying(false)
      return
    }

    isPlayingRef.current = true
    setIsAudioQueuePlaying(true)
    const nextAudioUrl = audioQueueRef.current.shift()!
    const audio = new Audio(nextAudioUrl)
    currentAudioRef.current = audio

    audio.onended = () => {
      URL.revokeObjectURL(nextAudioUrl)
      playNextInQueue()
    }

    audio.onerror = () => {
      URL.revokeObjectURL(nextAudioUrl)
      playNextInQueue()
    }

    audio.play().catch((err) => {
      console.warn('Audio autoplay blocked or failed:', err)
      playNextInQueue()
    })
  }

  // Function to fetch TTS for a complete sentence and push to queue
  const queueSentenceAudio = async (sentenceText: string, voicePreset: string) => {
    const clean = sentenceText.trim()
    if (clean.length < 2) return

    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clean,
          voice: voicePreset,
          targetLanguage: outputLanguageRef.current,
        }),
      })

      if (!res.ok) return

      const blob = await res.blob()
      const audioUrl = URL.createObjectURL(blob)
      audioQueueRef.current.push(audioUrl)

      if (!isPlayingRef.current) {
        playNextInQueue()
      }
    } catch (err) {
      console.error('Failed to stream sentence TTS:', err)
    }
  }

  // Cancel & flush function when user stops generation or submits a new query
  const stopAllAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }
    audioQueueRef.current.forEach((url) => URL.revokeObjectURL(url))
    audioQueueRef.current = []
    isPlayingRef.current = false
    setIsAudioQueuePlaying(false)
    sentenceBufferRef.current = ''
  }

  const handleStopSpeakingAndGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    stopAllAudio()

    setIsStreaming(false)
    stopRecording()

    setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
  }

  const stopVoiceActivityDetection = () => {
    if (voiceActivityFrameRef.current !== null) {
      cancelAnimationFrame(voiceActivityFrameRef.current)
      voiceActivityFrameRef.current = null
    }
    audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
    silenceStartedAtRef.current = null
  }

  // Browser-side voice activity detection ends an utterance after 1.2 seconds
  // of quiet. Whisper then performs the actual speech-to-text transcription.
  const startVoiceActivityDetection = (stream: MediaStream) => {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    const context = new AudioContextClass()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const silenceMs = 1200
    const speechThreshold = 12
    heardSpeechRef.current = false

    const monitor = () => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return
      analyser.getByteTimeDomainData(samples)
      let energy = 0
      for (const sample of samples) energy += Math.abs(sample - 128)
      const volume = energy / samples.length
      const now = performance.now()

      if (volume >= speechThreshold) {
        heardSpeechRef.current = true
        silenceStartedAtRef.current = null
      } else if (heardSpeechRef.current) {
        silenceStartedAtRef.current ??= now
        if (now - silenceStartedAtRef.current >= silenceMs) {
          stopRecording()
          return
        }
      }
      voiceActivityFrameRef.current = requestAnimationFrame(monitor)
    }

    audioContextRef.current = context
    monitor()
  }

  // Mic Recording (MediaRecorder STT + automatic end-of-speech detection)
  const startRecording = async () => {
    setVoiceError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const options =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
          ? { mimeType: 'audio/webm' }
          : undefined
      mediaRecorderRef.current = new MediaRecorder(stream, options)
      audioChunksRef.current = []

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorderRef.current.onstop = async () => {
        stopVoiceActivityDetection()
        stream.getTracks().forEach((track) => track.stop())
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

        if (audioBlob.size < 1000) {
          console.warn('Recorded audio is too short or empty.')
          return
        }

        await processAudioTranscription(audioBlob)
      }

      mediaRecorderRef.current.start()
      setIsRecording(true)
      startVoiceActivityDetection(stream)
    } catch (err: any) {
      console.error('Microphone error:', err)
      setVoiceError('Could not access microphone. Please check permissions.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      stopVoiceActivityDetection()
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  const processAudioTranscription = async (blob: Blob) => {
    setIsTranscribing(true)
    setVoiceError(null)
    try {
      const formData = new FormData()
      formData.append('file', blob, 'recording.webm')

      const res = await fetch('/api/voice/stt', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Speech transcription failed')
      }

      if (data.isSilent || !data.text || !data.text.trim()) {
        console.log('STT returned silence or empty text.')
        return
      }

      const transcript = data.text.trim()
      setInputQuestion(transcript)
      // Conversation mode sends the utterance to the RAG chat immediately. The
      // existing message history doubles as a readable, saved transcript.
      if (conversationModeRef.current) {
        await handleSendQuery(transcript)
      }
    } catch (err: any) {
      console.error('STT Error:', err)
      setVoiceError(err?.message || 'Error processing speech transcription')
    } finally {
      setIsTranscribing(false)
    }
  }

  // Text-to-Speech (TTS)
  const handlePlayTTS = async (msgId: string, text: string) => {
    stopAllAudio()

    if (playingMessageId === msgId) {
      if (audioElementRef.current) {
        audioElementRef.current.pause()
      }
      setPlayingMessageId(null)
      return
    }

    if (audioElementRef.current) {
      audioElementRef.current.pause()
    }

    setLoadingTTSId(msgId)
    setPlayingMessageId(null)
    setVoiceError(null)
    setAudioTime({ current: 0, duration: 0 })

    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: selectedVoice,
          targetLanguage: outputLanguageRef.current,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'TTS synthesis failed')
      }

      const audioBlob = await res.blob()
      const audioUrl = URL.createObjectURL(audioBlob)

      const audio = new Audio(audioUrl)
      audioElementRef.current = audio

      audio.ontimeupdate = () => {
        setAudioTime({
          current: audio.currentTime,
          duration: audio.duration || 0,
        })
      }

      audio.onended = () => {
        setPlayingMessageId(null)
      }

      audio.onerror = () => {
        setPlayingMessageId(null)
        setVoiceError('Failed to play synthesized audio')
      }

      await audio.play()
      setPlayingMessageId(msgId)
    } catch (err: any) {
      console.error('TTS Error:', err)
      setVoiceError(err?.message || 'Error generating voice response')
    } finally {
      setLoadingTTSId(null)
    }
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamStatus, setStreamStatus] = useState('Searching your notes...')

  useEffect(() => {
    let active = true
    const loadChatWorkspace = async () => {
      try {
        const meResponse = await fetch('/api/users/me', { credentials: 'include' })
        const meData = meResponse.ok ? await meResponse.json() : null
        if (!active) return
        const user = meData?.user
          ? { id: meData.user.id, name: meData.user.name, email: meData.user.email }
          : null
        setChatUser(user)
        if (!user) {
          const guestConversations = readGuestConversations()
          const savedId = localStorage.getItem(GUEST_ACTIVE_CONVERSATION_KEY)
          setConversations(guestConversations)
          if (savedId) {
            const saved = guestConversations.find((item) => String(item.id) === savedId)
            if (saved) {
              setConversationId(savedId)
              setMessages(saved.messages || [])
            } else {
              setConversationId(crypto.randomUUID())
            }
          } else setConversationId(crypto.randomUUID())
          return
        }
        const historyResponse = await fetch('/api/conversations', { credentials: 'include' })
        const historyData = historyResponse.ok
          ? await historyResponse.json()
          : { conversations: [] }
        if (!active) return
        const savedConversations = historyData.conversations || []
        setConversations(savedConversations)
        const savedId = sessionStorage.getItem('parsea_conversation_id')
        if (savedId) {
          const saved = savedConversations.find(
            (item: ConversationSummary) => String(item.id) === savedId,
          )
          if (saved) {
            const detailResponse = await fetch(`/api/conversations/${saved.id}`, {
              credentials: 'include',
            })
            const detail = detailResponse.ok ? await detailResponse.json() : null
            if (active && detail?.conversation) {
              setConversationId(String(detail.conversation.id))
              setMessages(detail.conversation.messages || [])
            }
          }
        }
      } catch {
        if (active) setConversations([])
      } finally {
        if (active) setHistoryLoading(false)
      }
    }
    loadChatWorkspace()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (shouldFollowRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  useEffect(() => () => stopVoiceActivityDetection(), [])

  const saveGuestConversation = (id: string, nextMessages: ChatMessageItem[]) => {
    if (chatUser || !id || nextMessages.length === 0) return
    const title =
      nextMessages.find((message) => message.role === 'user')?.content.slice(0, 80) ||
      'New conversation'
    const conversation: ConversationSummary = {
      id,
      title,
      messages: nextMessages,
      lastMessageAt: new Date().toISOString(),
    }
    const updated = [
      conversation,
      ...readGuestConversations().filter((item) => String(item.id) !== id),
    ].slice(0, MAX_GUEST_CONVERSATIONS)
    try {
      localStorage.setItem(GUEST_CONVERSATIONS_KEY, JSON.stringify(updated))
      localStorage.setItem(GUEST_ACTIVE_CONVERSATION_KEY, id)
      setConversations(updated)
    } catch {
      // Private-mode or quota failures should not interrupt chat.
    }
  }

  useEffect(() => {
    if (!chatUser && conversationId && messages.length > 0) {
      saveGuestConversation(conversationId, messages)
    }
  }, [chatUser, conversationId, messages])

  const handleStartNewChat = (options?: { discardCurrent?: boolean }) => {
    handleStopSpeakingAndGeneration()
    if (!options?.discardCurrent) saveGuestConversation(conversationId, messages)
    const nextId = crypto.randomUUID()
    if (!chatUser) localStorage.setItem(GUEST_ACTIVE_CONVERSATION_KEY, nextId)
    else sessionStorage.removeItem('parsea_conversation_id')
    setConversationId(nextId)
    setMessages([])
    setInputQuestion('')
    setHistoryOpen(false)
    setPendingDeleteId(null)
    shouldFollowRef.current = true
    setShowLatest(false)
  }

  const handleLoadConversation = async (id: string | number) => {
    if (isStreaming) return
    shouldFollowRef.current = true
    setShowLatest(false)
    setPendingDeleteId(null)
    if (!chatUser) {
      const conversation = readGuestConversations().find((item) => String(item.id) === String(id))
      if (!conversation) return
      saveGuestConversation(conversationId, messages)
      setConversationId(String(conversation.id))
      localStorage.setItem(GUEST_ACTIVE_CONVERSATION_KEY, String(conversation.id))
      setMessages(conversation.messages || [])
      setHistoryOpen(false)
      return
    }
    const response = await fetch(`/api/conversations/${id}`, { credentials: 'include' })
    if (!response.ok) return
    const data = await response.json()
    const conversation = data.conversation
    setConversationId(String(conversation.id))
    sessionStorage.setItem('parsea_conversation_id', String(conversation.id))
    setMessages(conversation.messages || [])
    setHistoryOpen(false)
  }

  const handleDeleteConversation = async (id: string | number) => {
    if (!chatUser) {
      const updated = readGuestConversations().filter((item) => String(item.id) !== String(id))
      localStorage.setItem(GUEST_CONVERSATIONS_KEY, JSON.stringify(updated))
      setConversations(updated)
      if (String(id) === conversationId) handleStartNewChat({ discardCurrent: true })
      return
    }
    const response = await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!response.ok) throw new Error('Could not delete conversation')
    setConversations((items) => items.filter((item) => String(item.id) !== String(id)))
    if (String(id) === conversationId) handleStartNewChat({ discardCurrent: true })
  }

  const persistConversation = async (
    id: string,
    nextMessages: ChatMessageItem[],
    title: string,
  ) => {
    if (!chatUser || !id) return
    const response = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, messages: nextMessages }),
    })
    if (response.ok) {
      const data = await response.json()
      setConversations((items) => [
        data.conversation,
        ...items.filter((item) => String(item.id) !== id),
      ])
    }
  }

  const confirmDeleteConversation = async () => {
    if (pendingDeleteId === null) return
    setIsDeleting(true)
    setHistoryError('')
    try {
      await handleDeleteConversation(pendingDeleteId)
      setPendingDeleteId(null)
    } catch {
      setHistoryError('Could not delete this chat. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSendQuery = async (queryText: string) => {
    const trimmed = queryText.trim()
    if (!trimmed || isStreaming) return
    shouldFollowRef.current = true
    setShowLatest(false)

    handleStopSpeakingAndGeneration()

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    const userMessage: ChatMessageItem = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }
    let currentConvId = conversationId
    let persistedConversation = Boolean(chatUser && conversationId && !conversationId.includes('-'))
    if (!currentConvId && chatUser) {
      const createResponse = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: trimmed, subject, semester, messages: [userMessage] }),
      })
      if (createResponse.ok) {
        const createData = await createResponse.json()
        currentConvId = String(createData.conversation.id)
        persistedConversation = true
        setConversations((items) => [createData.conversation, ...items])
      }
    }
    if (!currentConvId) currentConvId = crypto.randomUUID()
    if (!conversationId) {
      setConversationId(currentConvId)
      sessionStorage.setItem('parsea_conversation_id', currentConvId)
    }

    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessageItem = {
      id: assistantId,
      role: 'assistant',
      content: '',
      mode: chatMode,
      timestamp: Date.now(),
    }
    const updatedMessages = [...messages, userMessage]
    setMessages([...updatedMessages, assistantMessage])
    setInputQuestion('')
    setIsStreaming(true)

    const updateAssistant = (patch: Partial<ChatMessageItem>) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)),
      )
    }

    if (chatMode === 'quick') {
      setStreamStatus('Thinking it through...')
      try {
        const historyPayload = updatedMessages.slice(-5).map((m) => ({
          role: m.role,
          content: m.content,
        }))

        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            question: trimmed,
            mode: 'quick',
            targetLanguage: outputLanguageRef.current,
            messages: historyPayload,
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error((await response.text()) || 'Quick Chat request failed.')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let streamedContent = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          if (chunk) {
            streamedContent += chunk
            updateAssistant({ content: streamedContent })

            if (autoSpeakRef.current) {
              sentenceBufferRef.current += chunk
              const sentenceEndRegex = /([.?!।\n]+)/
              const parts = sentenceBufferRef.current.split(sentenceEndRegex)

              if (parts.length > 2) {
                while (parts.length > 2) {
                  const sentence = (parts.shift()! + parts.shift()!).trim()
                  if (sentence) {
                    queueSentenceAudio(sentence, selectedVoiceRef.current)
                  }
                }
                sentenceBufferRef.current = parts.join('')
              }
            }
          }
        }

        if (autoSpeakRef.current && sentenceBufferRef.current.trim()) {
          queueSentenceAudio(sentenceBufferRef.current.trim(), selectedVoiceRef.current)
          sentenceBufferRef.current = ''
        }

        if (persistedConversation) {
          const completedAssistant: ChatMessageItem = {
            ...assistantMessage,
            content: streamedContent,
          }
          await persistConversation(
            currentConvId,
            [...updatedMessages, completedAssistant],
            trimmed,
          )
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('Quick Chat stream aborted by user.')
        } else {
          console.error('Quick Chat Error:', err)
          updateAssistant({
            content: `**Error:** ${err?.message || 'Quick Chat failed. Please try again.'}`,
          })
        }
      } finally {
        setIsStreaming(false)
        setStreamStatus('Searching your notes...')
        if (abortControllerRef.current?.signal === signal) {
          abortControllerRef.current = null
        }
      }
    } else {
      // Deep Analysis Mode (Server Nemotron RAG)
      setStreamStatus('Searching your notes...')
      const filters = {
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(semester ? { semester: Number(semester) } : {}),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
      }
      const historyPayload = updatedMessages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      let completedAssistant: ChatMessageItem | null = null

      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            question: trimmed,
            conversationId: currentConvId,
            history: historyPayload,
            filters: Object.keys(filters).length > 0 ? filters : undefined,
            targetLanguage: outputLanguageRef.current,
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error((await response.text()) || 'Failed to start the response stream.')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let streamedContent = ''

        const processEvent = (rawEvent: string) => {
          const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'))
          if (!dataLine) return
          const event = JSON.parse(dataLine.slice(5).trim())

          if (event.type === 'metadata') {
            setStreamStatus('Writing your answer...')
            updateAssistant({
              sources: event.sources,
              images: event.images,
              cached: event.cached,
              retrievalBypassed: event.retrievalBypassed,
            })
          } else if (event.type === 'token') {
            const token = event.token || ''
            streamedContent += token
            updateAssistant({ content: streamedContent })

            if (autoSpeakRef.current) {
              sentenceBufferRef.current += token
              const sentenceEndRegex = /([.?!।\n]+)/
              const parts = sentenceBufferRef.current.split(sentenceEndRegex)

              if (parts.length > 2) {
                while (parts.length > 2) {
                  const sentence = (parts.shift()! + parts.shift()!).trim()
                  if (sentence) {
                    queueSentenceAudio(sentence, selectedVoiceRef.current)
                  }
                }
                sentenceBufferRef.current = parts.join('')
              }
            }
          } else if (event.type === 'done') {
            completedAssistant = {
              ...assistantMessage,
              content: event.answer || streamedContent,
              sources: event.sources,
              images: event.images,
              cached: event.cached,
              retrievalBypassed: event.retrievalBypassed,
              latencyMs: event.latencyMs,
            }
            updateAssistant(completedAssistant)

            if (autoSpeakRef.current && sentenceBufferRef.current.trim()) {
              queueSentenceAudio(sentenceBufferRef.current.trim(), selectedVoiceRef.current)
              sentenceBufferRef.current = ''
            }
          } else if (event.type === 'error') {
            throw new Error(event.error || 'The AI response stream failed.')
          }
        }

        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
          const events = buffer.split('\n\n')
          buffer = events.pop() || ''
          events.forEach(processEvent)
          if (done) break
        }
        if (buffer.trim()) processEvent(buffer)
        if (persistedConversation && completedAssistant) {
          await persistConversation(
            currentConvId,
            [...updatedMessages, completedAssistant],
            trimmed,
          )
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('Deep Analysis stream aborted by user.')
        } else {
          console.error('Deep Analysis Error:', err)
          updateAssistant({
            content: `**Error:** ${err?.message || 'Failed to generate response. Please try again.'}`,
          })
        }
      } finally {
        setIsStreaming(false)
        setStreamStatus('Searching your notes...')
        if (abortControllerRef.current?.signal === signal) {
          abortControllerRef.current = null
        }
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputQuestion.trim() && !isTranscribing) {
      handleSendQuery(inputQuestion)
    }
  }

  const isPending = isStreaming
  const lastIsAssistant =
    !isPending && messages.length > 0 && messages[messages.length - 1].role === 'assistant'

  const currentVoiceOption = VOICE_OPTIONS.find((v) => v.id === selectedVoice)
  const voiceShortName = currentVoiceOption
    ? currentVoiceOption.id === 'auto'
      ? 'Auto (HI/EN)'
      : currentVoiceOption.label.split(':')[0].replace(/hi-IN-|en-IN-|en-US-/, '')
    : 'Voice'

  const visibleConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(historySearch.trim().toLowerCase()),
  )

  return (
    <div className={`chat-shell parsea-theme parsea-chat${focusMode ? ' is-focus-mode' : ''}`}>
      <AmbientGrid />

      <div className="chat-workspace">
        <aside
          ref={sidebarRef}
          id="chat-history"
          className={`chat-history-sidebar${historyOpen ? ' is-open' : ''}`}
          aria-label="Chat history"
          role={sidebarIsDrawer ? 'dialog' : undefined}
          aria-modal={sidebarIsDrawer && historyOpen ? true : undefined}
          aria-hidden={sidebarIsDrawer && !historyOpen ? true : undefined}
          inert={sidebarIsDrawer && !historyOpen}
        >
          <div className="chat-sidebar-head">
            <Link href="/" className="chat-sidebar-brand">
              <BrandMark /> <span>Parsea</span>
            </Link>
            <button
              type="button"
              className="chat-sidebar-close"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close chat history"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="1" y1="1" x2="13" y2="13" />
                <line x1="13" y1="1" x2="1" y2="13" />
              </svg>
            </button>
          </div>
          <nav className="chat-sidebar-nav" aria-label="Main navigation">
            <Link href="/notes">
              Library <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/chat" aria-current="page">
              Study chat <span aria-hidden="true">✧</span>
            </Link>
          </nav>
          <button type="button" className="chat-new-button" onClick={() => handleStartNewChat()}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="6" y1="1" x2="6" y2="11" />
              <line x1="1" y1="6" x2="11" y2="6" />
            </svg>{' '}
            New chat
          </button>
          <label className="chat-history-search">
            <span className="visually-hidden">Search conversations</span>
            <input
              type="search"
              placeholder="Find a conversation…"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </label>
          {pendingDeleteId !== null && (
            <div className="chat-delete-confirm" role="alert">
              <p>Delete this conversation? This can’t be undone.</p>
              <div>
                <button
                  type="button"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={isDeleting}
                >
                  Keep it
                </button>
                <button type="button" onClick={confirmDeleteConversation} disabled={isDeleting}>
                  {isDeleting ? 'Deleting…' : 'Delete chat'}
                </button>
              </div>
            </div>
          )}
          {historyError && (
            <p className="chat-history-error" role="alert">
              {historyError}
            </p>
          )}
          <div className="chat-history-list">
            <span className="chat-history-label">Recent</span>
            {historyLoading ? (
              <p className="chat-history-empty" role="status">
                Loading history...
              </p>
            ) : visibleConversations.length === 0 ? (
              <p className="chat-history-empty">
                {historySearch
                  ? 'No matching chats. Try another search.'
                  : 'A question is a good place to start. Your conversations will live here.'}
              </p>
            ) : (
              visibleConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={`chat-history-item${String(conversation.id) === conversationId ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="chat-history-open"
                    onClick={() => handleLoadConversation(conversation.id)}
                    disabled={isStreaming}
                    aria-current={String(conversation.id) === conversationId ? 'true' : undefined}
                  >
                    <span className="chat-history-icon" aria-hidden="true">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 13 13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1.5 2h10a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H7l-2 2-2-2H1.5A.5.5 0 0 1 1 9.5v-7A.5.5 0 0 1 1.5 2Z" />
                      </svg>
                    </span>
                    <span className="chat-history-title">{conversation.title}</span>
                  </button>
                  <button
                    type="button"
                    className="chat-history-delete"
                    disabled={isStreaming || isDeleting}
                    onClick={() => {
                      setPendingDeleteId(conversation.id)
                      setHistoryError('')
                    }}
                    aria-label={`Delete ${conversation.title}`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <line x1="1" y1="1" x2="11" y2="11" />
                      <line x1="11" y1="1" x2="1" y2="11" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="chat-sidebar-footer">
            {!chatUser && (
              <p>Chats are saved on this device. Sign in to keep them across devices.</p>
            )}
            <AccountMenu user={chatUser} authChecked={!historyLoading} appearance="sidebar" />
          </div>
        </aside>
        {historyOpen && (
          <button
            type="button"
            className="chat-sidebar-backdrop"
            onClick={() => setHistoryOpen(false)}
            aria-label="Close chat history"
          />
        )}
        <div className="chat-main" ref={mainRef} inert={sidebarIsDrawer && historyOpen}>
          <header className="chat-workspace-heading">
            <h1 className="visually-hidden">Study chat</h1>
            <button
              type="button"
              className="chat-history-toggle"
              onClick={() => setHistoryOpen(true)}
              aria-label="Open chat history"
              aria-expanded={historyOpen}
              aria-controls="chat-history"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="5.5" />
                <polyline points="7 4 7 7 9 9" />
              </svg>{' '}
              <span className="visually-hidden">History</span>
            </button>
            <div
              className="chat-toolbar-course"
              title={`${branch || 'All departments'} · ${semester ? `Semester ${semester}` : 'All semesters'} · ${subject || 'All subjects'}`}
            >
              <strong>{subject || 'All subjects'}</strong>
              <span>
                {branch || 'All departments'} · {semester ? `Sem ${semester}` : 'All semesters'}
              </span>
            </div>
            <button
              type="button"
              className="chat-filters-toggle"
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              aria-controls="chat-scope-fields"
              aria-label="Edit study scope"
            >
              Edit scope <span aria-hidden="true">{showFilters ? '−' : '+'}</span>
            </button>
            <button
              type="button"
              className="chat-focus-toggle"
              aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
              aria-pressed={focusMode}
              onClick={() => {
                setFocusMode(!focusMode)
                setHistoryOpen(false)
                setShowFilters(false)
                setShowComposerSettings(false)
                setShowModelPopover(false)
                setShowLangPopover(false)
                setShowVoicePopover(false)
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" />
              </svg>
              <span>{focusMode ? 'Exit focus' : 'Focus'}</span>
            </button>
          </header>
          {/* ΓöÇΓöÇ Academic scope filters ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
          <div className="chat-scope">
            {showFilters && (
              <div className="chat-filters-panel" id="chat-scope-fields">
                <div className="form-group">
                  <label className="chat-filters-label" htmlFor="chat-branch">
                    Branch / department
                  </label>
                  <input
                    type="text"
                    id="chat-branch"
                    className="form-input"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="e.g. COMPS, IT"
                  />
                </div>
                <div className="form-group">
                  <label className="chat-filters-label" htmlFor="chat-semester">
                    Semester
                  </label>
                  <input
                    type="number"
                    id="chat-semester"
                    min={1}
                    max={8}
                    className="form-input"
                    value={semester}
                    onChange={(e) => setSemester(e.target.value ? Number(e.target.value) : '')}
                    placeholder="e.g. 3"
                  />
                </div>
                <div className="form-group">
                  <label className="chat-filters-label" htmlFor="chat-subject">
                    Subject
                  </label>
                  <input
                    type="text"
                    id="chat-subject"
                    className="form-input"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Discrete Mathematics"
                  />
                </div>
                <p className="chat-scope-hint">
                  Used by Deep analysis to search your course notes. Leave a field blank to search
                  more broadly.
                </p>
                <button
                  type="button"
                  className="chat-scope-done"
                  onClick={() => {
                    setShowFilters(false)
                    document
                      .querySelector<HTMLButtonElement>('[aria-label="Edit study scope"]')
                      ?.focus()
                  }}
                >
                  Done
                </button>
              </div>
            )}
          </div>

          {/* Scroll only the message feed; keep the composer and study scope in reach. */}
          <div
            className="chat-body"
            ref={feedRef}
            role="region"
            aria-label="Conversation"
            tabIndex={0}
            onScroll={(event) => {
              const feed = event.currentTarget
              const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 96
              shouldFollowRef.current = nearBottom
              setShowLatest(!nearBottom)
            }}
          >
            {/* ΓöÇΓöÇ Starter / empty state ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
            {messages.length === 0 && (
              <div className="chat-starters">
                <BrandMark className="chat-welcome-mark" />
                <p className="chat-welcome-kicker">A LITTLE HELP, A LOT MORE CLARITY</p>
                <h2 className="chat-starters-title">
                  What would you like
                  <br />
                  to <span>understand?</span>
                </h2>
                <p className="chat-starters-desc">
                  Start with a question. Work through it at your own pace.
                </p>
                <div className="chat-starters-chips">
                  {STARTERS.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="chat-starter-chip"
                      onClick={() => {
                        setInputQuestion(s)
                        inputRef.current?.focus()
                      }}
                    >
                      <span className="chat-starter-label">
                        {['Break it down', 'Spot the difference', 'Connect the ideas'][i]}
                      </span>
                      <span>{s}</span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ΓöÇΓöÇ Message thread ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-message-row chat-message-row--${msg.role}`}>
                <span className="chat-sender-label">{msg.role === 'user' ? 'You' : 'Parsea'}</span>

                {msg.role === 'user' ? (
                  <div className="chat-bubble-user">{msg.content}</div>
                ) : (
                  <div className="chat-card">
                    {/* Status badges */}
                    <div className="chat-card-header">
                      <span className="chat-card-label">
                        {msg.mode === 'quick'
                          ? 'Quick answer'
                          : msg.sources?.length
                            ? 'From your study materials'
                            : 'General explanation · No note sources'}
                      </span>
                      <div className="chat-card-badges" style={{ alignItems: 'center' }}>
                        {/* TTS Speaker Button & Player */}
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            marginRight: 6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handlePlayTTS(msg.id, msg.content)}
                            title={
                              playingMessageId === msg.id ? 'Pause voice' : 'Read answer aloud'
                            }
                            disabled={loadingTTSId === msg.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 8px',
                              fontSize: '0.75rem',
                              borderRadius: 6,
                              border: '1px solid var(--border-default)',
                              background:
                                playingMessageId === msg.id
                                  ? 'var(--green-100)'
                                  : 'var(--bg-surface)',
                              color:
                                playingMessageId === msg.id
                                  ? 'var(--green-800)'
                                  : 'var(--text-primary)',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            {loadingTTSId === msg.id ? (
                              <span
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <span
                                  className="btn-spinner"
                                  style={{ width: 10, height: 10, borderWidth: 1.5 }}
                                />{' '}
                                Synthesizing…
                              </span>
                            ) : playingMessageId === msg.id ? (
                              <span
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                  <rect x="1" y="1" width="3" height="8" rx="1" />
                                  <rect x="6" y="1" width="3" height="8" rx="1" />
                                </svg>{' '}
                                Pause
                              </span>
                            ) : (
                              <span
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                  <polygon points="1,1 9,5 1,9" />
                                </svg>{' '}
                                Listen
                              </span>
                            )}
                          </button>

                          {playingMessageId === msg.id && audioTime.duration > 0 && (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: '0.75rem',
                              }}
                            >
                              <input
                                type="range"
                                aria-label="Audio playback position"
                                min={0}
                                max={audioTime.duration}
                                step={0.1}
                                value={audioTime.current}
                                onChange={(e) => {
                                  const val = Number(e.target.value)
                                  if (audioElementRef.current)
                                    audioElementRef.current.currentTime = val
                                  setAudioTime((prev) => ({ ...prev, current: val }))
                                }}
                                style={{ width: 80, height: 4, cursor: 'pointer' }}
                              />
                              <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                                {Math.floor(audioTime.current)}s / {Math.floor(audioTime.duration)}s
                              </span>
                            </div>
                          )}
                        </div>

                        {msg.mode === 'quick' && (
                          <span
                            className="badge badge-purple badge-rounded"
                            title="Processed via Groq Quick Chat AI"
                          >
                            Quick Chat
                          </span>
                        )}
                        {msg.retrievalBypassed && (
                          <span
                            className="badge badge-blue badge-rounded"
                            title="Follow-up answered using cached context ΓÇö 0 DB queries"
                          >
                            Instant
                          </span>
                        )}
                        {msg.cached && (
                          <span className="badge badge-green badge-rounded">Cached</span>
                        )}
                        {msg.latencyMs !== undefined && (
                          <span className="text-muted text-xs">
                            {(msg.latencyMs / 1000).toFixed(2)}s
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Markdown + KaTeX */}
                    <div className="markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {normalizeMath(msg.content)}
                      </ReactMarkdown>
                    </div>

                    {/* Diagrams (Deep Analysis Mode) */}
                    {msg.images && msg.images.length > 0 && (
                      <details className="chat-section chat-evidence">
                        <summary className="chat-section-title">
                          Extracted diagrams ({msg.images.length})
                        </summary>
                        <div className="chat-img-grid">
                          {msg.images.map((img, i) => (
                            <div key={i} className="chat-img-card">
                              <button
                                type="button"
                                className="chat-img-preview"
                                aria-label={`Expand diagram: ${img.caption}`}
                                onClick={() => setSelectedImage(img.url)}
                              >
                                <img src={img.url} alt={img.caption} />
                                <span className="chat-img-page-badge">Pg {img.page}</span>
                              </button>
                              <div className="chat-img-caption">{img.caption}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Sources Pill / Grid */}
                    {msg.sources && msg.sources.length > 0 && (
                      <details className="chat-section chat-evidence">
                        <summary className="chat-section-title">
                          Sources ({msg.sources.length})
                        </summary>
                        <div className="chat-sources-grid">
                          {msg.sources.map((s, i) => (
                            <div key={i} className="chat-source-item">
                              <div className="chat-source-info">
                                <span className="chat-source-name">{s.document}</span>
                                <span className="chat-source-detail">
                                  {s.chapter ? `${s.chapter} · ` : ''}
                                  <span className="chat-source-page">Page {s.page}</span>
                                </span>
                              </div>
                              {s.url && (
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-primary btn-sm"
                                  style={{ flexShrink: 0 }}
                                >
                                  Open PDF
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {isPending && (
              <div className="chat-loading-bubble" role="status">
                <div className="spinner" />
                <span>{streamStatus}</span>
              </div>
            )}

            {/* Quick follow-up chips */}
            {lastIsAssistant && (
              <div className="chat-followups">
                <span className="chat-followup-label">Keep exploring</span>
                {QUICK_FOLLOW_UPS.map((chip, i) => (
                  <button
                    key={i}
                    type="button"
                    className="chat-followup-chip"
                    onClick={() => handleSendQuery(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
          {showLatest && messages.length > 0 && (
            <button
              type="button"
              className="chat-jump-latest"
              onClick={() => {
                shouldFollowRef.current = true
                feedRef.current?.scrollTo({
                  top: feedRef.current.scrollHeight,
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                })
                setShowLatest(false)
              }}
            >
              Jump to latest <span aria-hidden="true">↓</span>
            </button>
          )}

          {/* ΓöÇΓöÇ Sticky NotebookLM-style Input Card ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
          <div className="chat-input-bar" ref={composerRef}>
            {voiceError && (
              <div className="chat-voice-error" role="alert">
                <span>{voiceError}</span>
                <button
                  type="button"
                  onClick={() => setVoiceError(null)}
                  aria-label="Dismiss voice error"
                >
                  ×
                </button>
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className={`chat-composer${showComposerSettings ? ' is-settings-open' : ''}`}
            >
              <label htmlFor="chat-question" className="visually-hidden">
                Your study question
              </label>
              <textarea
                id="chat-question"
                ref={inputRef}
                className="chat-question"
                rows={1}
                value={inputQuestion}
                onChange={(event) => setInputQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (inputQuestion.trim() && !isTranscribing && !isStreaming)
                      handleSendQuery(inputQuestion)
                  }
                }}
                placeholder={
                  messages.length === 0
                    ? 'A question, a tricky concept, a little help…'
                    : 'Ask a follow-up…'
                }
                disabled={isTranscribing}
                aria-describedby="chat-composer-hint"
              />
              <div className="chat-composer-toolbar">
                <button
                  type="button"
                  className="chat-settings-toggle"
                  aria-label="Chat settings"
                  aria-expanded={showComposerSettings}
                  aria-controls="chat-composer-settings"
                  onClick={() => {
                    setShowComposerSettings(!showComposerSettings)
                    setShowModelPopover(false)
                    setShowLangPopover(false)
                    setShowVoicePopover(false)
                  }}
                >
                  <span aria-hidden="true">⚙</span> Settings
                </button>
                <div className="chat-composer-settings" id="chat-composer-settings">
                  <div className="chat-popover-anchor" ref={modelPopoverRef}>
                    <button
                      type="button"
                      className="chat-control-pill"
                      aria-expanded={showModelPopover}
                      aria-controls="chat-mode-options"
                      onClick={() => {
                        setShowModelPopover(!showModelPopover)
                        setShowVoicePopover(false)
                        setShowLangPopover(false)
                      }}
                    >
                      <span aria-hidden="true">{chatMode === 'quick' ? '✧' : '◈'}</span>
                      {chatMode === 'quick' ? 'Quick chat' : 'Deep analysis'}
                      <span className="chat-control-chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </button>
                    {showModelPopover && (
                      <div
                        className="chat-settings-popover"
                        id="chat-mode-options"
                        role="group"
                        aria-label="Response mode"
                      >
                        <p className="chat-popover-heading">How would you like to learn?</p>
                        <button
                          type="button"
                          className="chat-option"
                          aria-pressed={chatMode === 'quick'}
                          onClick={() => {
                            handleModeChange('quick')
                            setShowModelPopover(false)
                            modelPopoverRef.current?.querySelector('button')?.focus()
                          }}
                        >
                          <strong>Quick chat</strong>
                          <span>
                            A quick explanation or a conversation. Not grounded in your uploaded
                            notes.
                          </span>
                        </button>
                        <button
                          type="button"
                          className="chat-option"
                          aria-pressed={chatMode === 'deep'}
                          onClick={() => {
                            handleModeChange('deep')
                            setShowModelPopover(false)
                            modelPopoverRef.current?.querySelector('button')?.focus()
                          }}
                        >
                          <strong>Deep analysis</strong>
                          <span>
                            Search your study scope and explain with document sources when
                            available.
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="chat-popover-anchor" ref={langPopoverRef}>
                    <button
                      type="button"
                      className="chat-control-pill"
                      aria-label="Response language"
                      aria-expanded={showLangPopover}
                      aria-controls="chat-language-options"
                      onClick={() => {
                        setShowLangPopover(!showLangPopover)
                        setShowModelPopover(false)
                        setShowVoicePopover(false)
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        aria-hidden="true"
                      >
                        <circle cx="7" cy="7" r="5.5" />
                        <ellipse cx="7" cy="7" rx="2.5" ry="5.5" />
                        <path d="M1.5 7h11" />
                      </svg>
                      {outputLanguage === 'en'
                        ? 'English'
                        : outputLanguage === 'hi'
                          ? 'Hindi'
                          : 'Language'}
                      <span className="chat-control-chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </button>
                    {showLangPopover && (
                      <div
                        className="chat-settings-popover"
                        id="chat-language-options"
                        role="group"
                        aria-label="Response language options"
                      >
                        <p className="chat-popover-heading">Answer language</p>
                        {LANG_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className="chat-option chat-option-compact"
                            aria-pressed={outputLanguage === option.id}
                            onClick={() => {
                              handleLanguageChange(option.id)
                              setShowLangPopover(false)
                              langPopoverRef.current?.querySelector('button')?.focus()
                            }}
                          >
                            <span>
                              {option.id === 'auto'
                                ? 'Match my question'
                                : option.id === 'en'
                                  ? 'English'
                                  : 'Hindi'}
                            </span>
                            {outputLanguage === option.id && <span aria-hidden="true">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="chat-popover-anchor" ref={voicePopoverRef}>
                    <button
                      type="button"
                      className="chat-control-pill"
                      aria-label="Voice settings"
                      aria-expanded={showVoicePopover}
                      aria-controls="chat-voice-options"
                      onClick={() => {
                        setShowVoicePopover(!showVoicePopover)
                        setShowModelPopover(false)
                        setShowLangPopover(false)
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M2 5h3l3-3v10l-3-3H2Z" />
                        <path d="M10 4a4 4 0 0 1 0 6" />
                      </svg>
                      Voice
                      <span className="chat-control-chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </button>
                    {showVoicePopover && (
                      <div
                        className="chat-settings-popover chat-voice-popover"
                        id="chat-voice-options"
                        role="group"
                        aria-label="Voice preferences"
                      >
                        <p className="chat-popover-heading">Voice · {voiceShortName}</p>
                        <div className="chat-voice-options">
                          {VOICE_OPTIONS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className="chat-option chat-option-compact"
                              aria-pressed={selectedVoice === option.id}
                              onClick={() => handleVoiceChange(option.id)}
                            >
                              <span>
                                {option.id === 'auto'
                                  ? 'Auto · Hindi / English'
                                  : option.label.split(':')[1]?.trim() || option.label}
                              </span>
                              {selectedVoice === option.id && <span aria-hidden="true">✓</span>}
                            </button>
                          ))}
                        </div>
                        <div className="chat-voice-switches">
                          <button
                            type="button"
                            className="chat-setting-switch"
                            role="switch"
                            aria-checked={autoSpeak}
                            onClick={() => setAutoSpeak(!autoSpeak)}
                          >
                            <span>
                              <strong>Read answers aloud</strong>
                              <small>Play answers as they arrive.</small>
                            </span>
                            <span className="chat-switch-track" aria-hidden="true">
                              <span />
                            </span>
                          </button>
                          <button
                            type="button"
                            className="chat-setting-switch"
                            role="switch"
                            aria-checked={conversationMode}
                            onClick={() => setConversationMode(!conversationMode)}
                          >
                            <span>
                              <strong>Hands-free conversation</strong>
                              <small>Send voice input when you pause.</small>
                            </span>
                            <span className="chat-switch-track" aria-hidden="true">
                              <span />
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="chat-composer-actions">
                  {(isStreaming || isAudioQueuePlaying) && (
                    <button
                      type="button"
                      className="chat-stop-button"
                      onClick={handleStopSpeakingAndGeneration}
                      aria-label="Stop response and audio"
                    >
                      <span aria-hidden="true">■</span> Stop
                    </button>
                  )}
                  <button
                    type="button"
                    className={`chat-icon-button${isRecording ? ' is-recording' : ''}`}
                    onClick={toggleRecording}
                    disabled={isPending || isTranscribing}
                    aria-label={isRecording ? 'Stop recording' : 'Record a voice question'}
                    aria-pressed={isRecording}
                    title={
                      isRecording ? 'Listening — stops after you pause' : 'Ask with your voice'
                    }
                  >
                    {isTranscribing ? (
                      <span className="btn-spinner" />
                    ) : (
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <rect x="6" y="1.5" width="6" height="10" rx="3" />
                        <path d="M3.5 8.5a5.5 5.5 0 0 0 11 0M9 14v2.5M6.5 16.5h5" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="submit"
                    className="chat-send-button"
                    disabled={!inputQuestion.trim() || isTranscribing || isStreaming}
                    aria-label="Send question"
                    title="Send question"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 9h12m-5-5 5 5-5 5" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>
            <div className="chat-composer-footnote" id="chat-composer-hint">
              <span>
                {chatMode === 'quick'
                  ? 'Quick chat · General explanations'
                  : 'Deep analysis · Your notes + sources'}
                {autoSpeak && <span className="chat-audio-indicator"> · Audio on</span>}
              </span>
              <span className="chat-keyboard-hint">
                Enter to send · Shift + Enter for a new line
              </span>
            </div>
            <p className="chat-ai-disclaimer">
              AI can make mistakes. Check sources for important details.
            </p>
          </div>

          {/* Diagram zoom overlay */}
          {selectedImage && (
            <div
              ref={zoomRef}
              tabIndex={-1}
              className="zoom-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Expanded diagram"
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelectedImage(null)
              }}
            >
              <div>
                <button
                  type="button"
                  className="chat-zoom-close"
                  aria-label="Close expanded diagram"
                  onClick={() => setSelectedImage(null)}
                >
                  Close ×
                </button>
                <img src={selectedImage} alt="Expanded diagram" className="zoom-img" />
                <p className="zoom-hint">Press Escape or click outside the diagram to close.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="chat-shell parsea-theme" />}>
      <ChatWorkspace />
    </Suspense>
  )
}
