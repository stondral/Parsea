'use client'

import React, { useState, useEffect, useRef } from 'react'
import { LMSNavbar } from '@/components/LMSNavbar'
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

export default function ChatPage() {
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
  const [historyLoading, setHistoryLoading] = useState(true)

  // Dual-Mode State
  const [chatMode, setChatMode] = useState<'quick' | 'deep'>('quick')
  const [expandedSourcesId, setExpandedSourcesId] = useState<string | null>(null)

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
  const [audioTime, setAudioTime] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 })

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
    if (savedLang === 'auto' || savedLang === 'en' || savedLang === 'hi') setOutputLanguage(savedLang)
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
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

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
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
        const user = meData?.user ? { id: meData.user.id, name: meData.user.name, email: meData.user.email } : null
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
        const historyData = historyResponse.ok ? await historyResponse.json() : { conversations: [] }
        if (!active) return
        const savedConversations = historyData.conversations || []
        setConversations(savedConversations)
        const savedId = sessionStorage.getItem('parsea_conversation_id')
        if (savedId) {
          const saved = savedConversations.find((item: ConversationSummary) => String(item.id) === savedId)
          if (saved) {
            const detailResponse = await fetch(`/api/conversations/${saved.id}`, { credentials: 'include' })
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
    return () => { active = false }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  useEffect(() => () => stopVoiceActivityDetection(), [])

  const saveGuestConversation = (id: string, nextMessages: ChatMessageItem[]) => {
    if (chatUser || !id || nextMessages.length === 0) return
    const title = nextMessages.find((message) => message.role === 'user')?.content.slice(0, 80) || 'New conversation'
    const conversation: ConversationSummary = {
      id,
      title,
      messages: nextMessages,
      lastMessageAt: new Date().toISOString(),
    }
    const updated = [conversation, ...readGuestConversations().filter((item) => String(item.id) !== id)].slice(0, MAX_GUEST_CONVERSATIONS)
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

  const handleStartNewChat = () => {
    handleStopSpeakingAndGeneration()
    saveGuestConversation(conversationId, messages)
    const nextId = crypto.randomUUID()
    if (!chatUser) localStorage.setItem(GUEST_ACTIVE_CONVERSATION_KEY, nextId)
    else sessionStorage.removeItem('parsea_conversation_id')
    setConversationId(nextId)
    setMessages([])
    setInputQuestion('')
    setHistoryOpen(false)
  }

  const handleLoadConversation = async (id: string | number) => {
    if (isStreaming) return
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
      if (String(id) === conversationId) handleStartNewChat()
      return
    }
    const response = await fetch(`/api/conversations/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!response.ok) return
    setConversations((items) => items.filter((item) => String(item.id) !== String(id)))
    if (String(id) === conversationId) handleStartNewChat()
  }

  const persistConversation = async (id: string, nextMessages: ChatMessageItem[], title: string) => {
    if (!chatUser || !id) return
    const response = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, messages: nextMessages }),
    })
    if (response.ok) {
      const data = await response.json()
      setConversations((items) => [data.conversation, ...items.filter((item) => String(item.id) !== id)])
    }
  }

  const handleSendQuery = async (queryText: string) => {
    const trimmed = queryText.trim()
    if (!trimmed) return

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
        prev.map((message) =>
          message.id === assistantId ? { ...message, ...patch } : message
        )
      )
    }

    if (chatMode === 'quick') {
      setStreamStatus('Generating quick spoken response...')
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
          await persistConversation(currentConvId, [...updatedMessages, completedAssistant], trimmed)
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
          await persistConversation(currentConvId, [...updatedMessages, completedAssistant], trimmed)
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

  return (
    <div className="chat-shell">
      <LMSNavbar branch={branch} semester={semester || 3} />

      <div className="chat-workspace">
        <aside className={`chat-history-sidebar${historyOpen ? ' is-open' : ''}`}>
          <div className="chat-sidebar-head">
            <div>
              <span className="chat-sidebar-kicker">PARSEA</span>
              <h2>Conversations</h2>
            </div>
            <button type="button" className="chat-sidebar-close" onClick={() => setHistoryOpen(false)} aria-label="Close chat history">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
            </button>
          </div>
          <button type="button" className="chat-new-button" onClick={handleStartNewChat}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg> New chat
          </button>
          <div className="chat-history-list">
              <span className="chat-history-label">Recent</span>
              {historyLoading ? <p className="chat-history-empty">Loading history...</p> : conversations.length === 0 ? <p className="chat-history-empty">Your saved conversations will appear here.</p> : conversations.map((conversation) => (
                <div key={conversation.id} className={`chat-history-item${String(conversation.id) === conversationId ? ' active' : ''}`}>
                  <button type="button" className="chat-history-open" onClick={() => handleLoadConversation(conversation.id)}>
                    <span className="chat-history-icon" aria-hidden="true">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 2h10a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H7l-2 2-2-2H1.5A.5.5 0 0 1 1 9.5v-7A.5.5 0 0 1 1.5 2Z"/></svg>
                    </span>
                    <span className="chat-history-title">{conversation.title}</span>
                  </button>
                  <button type="button" className="chat-history-delete" onClick={() => handleDeleteConversation(conversation.id)} aria-label={`Delete ${conversation.title}`}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
                  </button>
                </div>
              ))}
          {!chatUser && (
            <div className="chat-history-signin">
              <p>Saved on this device. Sign in to continue them on another device.</p>
              <a href="/login">Sign in</a>
            </div>
          )}
          </div>
        </aside>
        {historyOpen && <button type="button" className="chat-sidebar-backdrop" onClick={() => setHistoryOpen(false)} aria-label="Close chat history" />}
        <div className="chat-main">
          <button type="button" className="chat-history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Open chat history">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><polyline points="7 4 7 7 9 9"/></svg> History
          </button>

      {/* Message feed */}
      <div className="chat-body">
        {/* ΓöÇΓöÇ Academic scope filters ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
        <div>
          <button
            type="button"
            className="chat-filters-toggle"
            onClick={() => setShowFilters(!showFilters)}
          >
            <span aria-hidden="true">{showFilters ? '▲' : '▼'}</span>
            <span>
              Scope: {branch} · Sem {semester || '?'} · {subject || 'All Subjects'}
            </span>
          </button>

          {showFilters && (
            <div className="chat-filters-panel">
              <div className="form-group">
                <label className="chat-filters-label">Branch / Dept</label>
                <input
                  type="text"
                  className="form-input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="e.g. COMPS, IT"
                />
              </div>
              <div className="form-group">
                <label className="chat-filters-label">Semester</label>
                <input
                  type="number"
                  className="form-input"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value ? Number(e.target.value) : '')}
                  placeholder="e.g. 3"
                />
              </div>
              <div className="form-group">
                <label className="chat-filters-label">Subject</label>
                <input
                  type="text"
                  className="form-input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Discrete Mathematics"
                />
              </div>
            </div>
          )}
        </div>

        {/* ΓöÇΓöÇ Starter / empty state ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
        {messages.length === 0 && (
          <div className="chat-starters">
            <p className="chat-starters-title">Start an Academic Discussion</p>
            <p className="chat-starters-desc">
              Ask anything about your study materials. Quick Chat runs in-browser via WebGPU, while Deep Analysis uses Nemotron RAG with citations.
            </p>
            <div className="chat-starters-chips">
              {STARTERS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="chat-starter-chip"
                  onClick={() => handleSendQuery(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ΓöÇΓöÇ Message thread ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message-row chat-message-row--${msg.role}`}
          >
            <span className="chat-sender-label">
              {msg.role === 'user' ? 'You' : msg.mode === 'quick' ? 'Parsea (WebGPU)' : 'Parsea'}
            </span>

            {msg.role === 'user' ? (
              <div className="chat-bubble-user">{msg.content}</div>
            ) : (
              <div className="chat-card">
                {/* Status badges */}
                <div className="chat-card-header">
                  <span className="chat-card-label">
                    {msg.mode === 'quick' ? 'Quick Answer (WebGPU)' : 'Response'}
                  </span>
                  <div className="chat-card-badges" style={{ alignItems: 'center' }}>
                    {/* TTS Speaker Button & Player */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
                      <button
                        type="button"
                        onClick={() => handlePlayTTS(msg.id, msg.content)}
                        title={playingMessageId === msg.id ? 'Pause Voice' : 'Read aloud with Edge-TTS'}
                        disabled={loadingTTSId === msg.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          fontSize: '0.75rem',
                          borderRadius: 6,
                          border: '1px solid var(--border-default)',
                          background: playingMessageId === msg.id ? 'var(--green-100)' : 'var(--bg-surface)',
                          color: playingMessageId === msg.id ? 'var(--green-800)' : 'var(--text-primary)',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {loadingTTSId === msg.id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span className="btn-spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Synthesizing…</span>
                        ) : playingMessageId === msg.id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="3" height="8" rx="1"/><rect x="6" y="1" width="3" height="8" rx="1"/></svg> Pause</span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="1,1 9,5 1,9"/></svg> Listen</span>
                        )}
                      </button>

                      {playingMessageId === msg.id && audioTime.duration > 0 && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                          <input
                            type="range"
                            min={0}
                            max={audioTime.duration}
                            step={0.1}
                            value={audioTime.current}
                            onChange={(e) => {
                              const val = Number(e.target.value)
                              if (audioElementRef.current) audioElementRef.current.currentTime = val
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
                      <span className="badge badge-purple badge-rounded" title="Processed via Groq Quick Chat AI">
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
                  <div className="chat-section">
                    <span className="chat-section-title">
                      Extracted diagrams ({msg.images.length})
                    </span>
                    <div className="chat-img-grid">
                      {msg.images.map((img, i) => (
                        <div key={i} className="chat-img-card">
                          <div
                            className="chat-img-preview"
                            onClick={() => setSelectedImage(img.url)}
                          >
                            <img src={img.url} alt={img.caption} />
                            <span className="chat-img-page-badge">Pg {img.page}</span>
                          </div>
                          <div className="chat-img-caption">{img.caption}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources Pill / Grid */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="chat-section">
                    {msg.mode === 'quick' ? (
                      <div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                          onClick={() =>
                            setExpandedSourcesId(expandedSourcesId === msg.id ? null : msg.id)
                          }
                        >
                          Sources ({msg.sources.length}) {expandedSourcesId === msg.id ? '▲' : '▼'}
                        </button>
                        {expandedSourcesId === msg.id && (
                          <div className="chat-sources-grid" style={{ marginTop: 8 }}>
                            {msg.sources.map((s, i) => (
                              <div key={i} className="chat-source-item">
                                <div className="chat-source-info">
                                  <span className="chat-source-name">{s.document}</span>
                                  <span className="chat-source-detail">
                                    {s.chapter ? `${s.chapter} · ` : ''}
                                    <span className="chat-source-page">Page {s.page}</span>
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <span className="chat-section-title">Citations</span>
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
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isPending && (
          <div className="chat-loading-bubble">
            <div className="spinner" />
            <span>{streamStatus}</span>
          </div>
        )}

        {/* Quick follow-up chips */}
        {lastIsAssistant && (
          <div className="chat-followups">
            <span className="chat-followup-label">Follow-up:</span>
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

      {/* ΓöÇΓöÇ Sticky NotebookLM-style Input Card ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ */}
      <div className="chat-input-bar max-w-3xl mx-auto w-full px-4 mb-3">
        {voiceError && (
          <div
            style={{
              padding: '6px 12px',
              marginBottom: '8px',
              borderRadius: '6px',
              backgroundColor: '#ffebee',
              color: '#c62828',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}><circle cx="6.5" cy="6.5" r="5.5"/><line x1="6.5" y1="4" x2="6.5" y2="7"/><circle cx="6.5" cy="9" r="0.6" fill="currentColor"/></svg> {voiceError}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border/60 bg-background/95 shadow-sm backdrop-blur focus-within:ring-2 focus-within:ring-primary/20 transition-all overflow-visible relative"
          style={{
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '16px',
            border: '1px solid var(--border-default, #e0e0e0)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
        >
          {/* Textarea on Top (Compact single line, max 112px) */}
          <textarea
            ref={inputRef}
            className="w-full bg-transparent border-none resize-none outline-none focus:ring-0 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground min-h-[40px] max-h-28 overflow-y-auto"
            rows={1}
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (inputQuestion.trim() && !isTranscribing) {
                  handleSendQuery(inputQuestion)
                }
              }
            }}
            placeholder={
              messages.length === 0
                ? "Ask anything — e.g. 'explain pigeonhole principle with diagrams'…"
                : "Ask a follow-up…"
            }
            disabled={isTranscribing}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              resize: 'none',
              outline: 'none',
              padding: '8px 12px',
              fontSize: '0.88rem',
              color: 'var(--text-primary, #111)',
              fontFamily: 'inherit',
              minHeight: '40px',
              maxHeight: '112px',
              overflowY: 'auto',
            }}
          />

          {/* Unified Bottom Action Bar */}
          <div
            className="flex items-center justify-between py-1.5 px-2.5 border-t border-border/40"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              borderTop: '1px solid var(--border-default, #f0f0f0)',
              gap: 8,
            }}
          >
            {/* Left Group (Model, Language & Voice Pills) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Model Selector Pill */}
              <div className="relative" ref={modelPopoverRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowModelPopover(!showModelPopover)
                    setShowVoicePopover(false)
                    setShowLangPopover(false)
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/60 hover:bg-muted text-foreground transition-colors"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 9px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: 'var(--bg-muted, #f5f5f5)',
                    color: 'var(--text-primary, #333)',
                    border: '1px solid var(--border-default, #e0e0e0)',
                    cursor: 'pointer',
                  }}
                >
                  <span>{chatMode === 'quick' ? '⚡ Quick Chat' : '◈ Deep Analysis'}</span>
                  <span style={{ fontSize: '0.62rem', opacity: 0.7 }}>▾</span>
                </button>

                {showModelPopover && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: 8,
                      width: 270,
                      padding: 6,
                      background: 'var(--bg-surface, #ffffff)',
                      borderRadius: 12,
                      border: '1px solid var(--border-default, #e0e0e0)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      zIndex: 50,
                    }}
                  >
                    <div
                      onClick={() => {
                        handleModeChange('quick')
                        setShowModelPopover(false)
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: chatMode === 'quick' ? '#e3f2fd' : 'transparent',
                        border: chatMode === 'quick' ? '1px solid #90caf9' : '1px solid transparent',
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, color: '#111' }}>
                        <span>⚡ Quick Chat</span>
                        <span style={{ fontSize: '0.68rem', color: '#1976d2', fontFamily: 'monospace' }}>(Groq AI)</span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: '#666', marginTop: 2, margin: 0 }}>
                        Blazing-fast conversational answers & instant voice synthesis.
                      </p>
                    </div>

                    <div
                      onClick={() => {
                        handleModeChange('deep')
                        setShowModelPopover(false)
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: chatMode === 'deep' ? '#e3f2fd' : 'transparent',
                        border: chatMode === 'deep' ? '1px solid #90caf9' : '1px solid transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, color: '#111' }}>
                        <span>◈ Deep Analysis</span>
                        <span style={{ fontSize: '0.68rem', color: '#1976d2', fontFamily: 'monospace' }}>(Server RAG)</span>
                      </div>
                      <p style={{ fontSize: '0.72rem', color: '#666', marginTop: 2, margin: 0 }}>
                        Full Nemotron RAG research, document citations & deep reasoning.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Language Selector Pill */}
              <div className="relative" ref={langPopoverRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowLangPopover(!showLangPopover)
                    setShowModelPopover(false)
                    setShowVoicePopover(false)
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/60 hover:bg-muted text-foreground transition-colors"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 9px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: 'var(--bg-muted, #f5f5f5)',
                    color: 'var(--text-primary, #333)',
                    border: '1px solid var(--border-default, #e0e0e0)',
                    cursor: 'pointer',
                  }}
                >
                  <span>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3 }}><circle cx="5.5" cy="5.5" r="4.5"/><path d="M5.5 1c-1.2 1.5-1.2 7.5 0 9"/><path d="M5.5 1c1.2 1.5 1.2 7.5 0 9"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
                    {outputLanguage === 'en' ? 'EN' : outputLanguage === 'hi' ? 'HI' : 'Lang: Auto'}
                  </span>
                  <span style={{ fontSize: '0.62rem', opacity: 0.7 }}>▾</span>
                </button>

                {showLangPopover && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: 8,
                      width: 250,
                      padding: 8,
                      background: 'var(--bg-surface, #ffffff)',
                      borderRadius: 12,
                      border: '1px solid var(--border-default, #e0e0e0)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      zIndex: 50,
                    }}
                  >
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 6px 6px 6px' }}>
                      Output Language
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {LANG_OPTIONS.map((l) => (
                        <div
                          key={l.id}
                          onClick={() => {
                            handleLanguageChange(l.id)
                            setShowLangPopover(false)
                          }}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: outputLanguage === l.id ? '#e3f2fd' : 'transparent',
                            color: outputLanguage === l.id ? '#1976d2' : '#333',
                            fontWeight: outputLanguage === l.id ? 600 : 400,
                          }}
                        >
                          <span>{l.label}</span>
                          {outputLanguage === l.id && <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Voice Settings Pill */}
              <div className="relative" ref={voicePopoverRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowVoicePopover(!showVoicePopover)
                    setShowModelPopover(false)
                    setShowLangPopover(false)
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/60 hover:bg-muted text-foreground transition-colors"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 9px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: 'var(--bg-muted, #f5f5f5)',
                    color: 'var(--text-primary, #333)',
                    border: '1px solid var(--border-default, #e0e0e0)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 1a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0V3a2 2 0 0 1 2-2Z"/><path d="M2 6a3.5 3.5 0 0 0 7 0"/><line x1="5.5" y1="9.5" x2="5.5" y2="10.5"/></svg>
                    {selectedVoice === 'auto' ? 'Voice: Auto' : selectedVoice.includes('Swara') ? 'Hindi (Swara)' : selectedVoice.includes('Madhur') ? 'Hindi (Madhur)' : selectedVoice.includes('Neerja') ? 'English (Neerja)' : selectedVoice.includes('Prabhat') ? 'English (Prabhat)' : selectedVoice.includes('Jenny') ? 'English (Jenny)' : 'Voice'}
                  </span>
                  <span style={{ fontSize: '0.62rem', opacity: 0.7 }}>▾</span>
                </button>

                {showVoicePopover && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      marginBottom: 8,
                      width: 250,
                      padding: 8,
                      background: 'var(--bg-surface, #ffffff)',
                      borderRadius: 12,
                      border: '1px solid var(--border-default, #e0e0e0)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      zIndex: 50,
                    }}
                  >
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 6px 6px 6px' }}>
                      Voice Preset
                    </div>
                    <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {VOICE_OPTIONS.map((v) => (
                        <div
                          key={v.id}
                          onClick={() => handleVoiceChange(v.id)}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 6,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: selectedVoice === v.id ? '#e3f2fd' : 'transparent',
                            color: selectedVoice === v.id ? '#1976d2' : '#333',
                            fontWeight: selectedVoice === v.id ? 600 : 400,
                          }}
                        >
                          <span>{v.label.split(':')[1] || v.label}</span>
                          {selectedVoice === v.id && <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/></svg>}
                        </div>
                      ))}
                    </div>

                    <div style={{ margin: '8px 0', borderTop: '1px solid #eee' }} />

                    {/* Auto-Speak Switch */}
                    <div
                      onClick={() => setAutoSpeak(!autoSpeak)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#f9f9f9',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#333' }}>Auto-Speak Answers</span>
                      <span style={{ color: autoSpeak ? '#2e7d32' : '#999', fontWeight: 700 }}>
                        {autoSpeak ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div
                      onClick={() => setConversationMode(!conversationMode)}
                      style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9f9f9' }}
                    >
                      <span style={{ fontWeight: 600, color: '#333' }}>Conversation mode (auto-send)</span>
                      <span style={{ color: conversationMode ? '#2e7d32' : '#999', fontWeight: 700 }}>
                        {conversationMode ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Stop Speaking / Generation Button */}
              {(isStreaming || isAudioQueuePlaying) && (
                <button
                  type="button"
                  onClick={handleStopSpeakingAndGeneration}
                  title="Stop playback and cancel stream generation"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 9px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: '#ffebee',
                    color: '#d32f2f',
                    border: '1px solid #ef5350',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><rect x="0.5" y="0.5" width="8" height="8" rx="1.5"/></svg> Stop</span>
                </button>
              )}
            </div>

            {/* Right Group (Actions: h-7 w-7 icons) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* New Chat Button */}
              <button
                type="button"
                onClick={handleStartNewChat}
                title="Start new conversation"
                className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v5M7 8v5M1 7h5M8 7h5"/></svg>
              </button>

              {/* Microphone Button */}
              <button
                type="button"
                onClick={toggleRecording}
                disabled={isPending || isTranscribing}
                title={isRecording ? 'Listening — stops after you pause' : conversationMode ? 'Start hands-free conversation with your notes' : 'Voice input — stops after you pause'}
                className={`h-7 w-7 rounded-full flex items-center justify-center transition-all ${
                  isRecording ? 'bg-red-500/10 text-red-500 animate-pulse' : ''
                }`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: isRecording ? '1px solid #ef5350' : 'none',
                  background: isRecording ? '#ffebee' : 'transparent',
                  color: isRecording ? '#d32f2f' : 'inherit',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                {isTranscribing
                  ? <span className="btn-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  : isRecording
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="5"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 1a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V3a2 2 0 0 1 2-2Z"/><path d="M2.5 7a4 4 0 0 0 8 0"/><line x1="6.5" y1="11" x2="6.5" y2="12.5"/></svg>
                }
              </button>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!inputQuestion.trim() || isTranscribing}
                className="h-7 w-7 rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 flex items-center justify-center transition-all cursor-pointer shadow-sm"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'var(--color-primary, #0052cc)',
                  color: '#ffffff',
                  cursor: !inputQuestion.trim() || isTranscribing ? 'not-allowed' : 'pointer',
                  opacity: !inputQuestion.trim() || isTranscribing ? 0.4 : 1,
                  fontSize: '0.8rem',
                }}
              >
                {isStreaming
                  ? <span className="btn-spinner" style={{ width: 12, height: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} />
                  : <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="6.5" x2="11" y2="6.5"/><polyline points="7.5,3 11,6.5 7.5,10"/></svg>
                }
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Diagram zoom overlay */}
      {selectedImage && (
        <div className="zoom-overlay" onClick={() => setSelectedImage(null)}>
          <div>
            <img src={selectedImage} alt="Expanded diagram" className="zoom-img" />
            <p className="zoom-hint">Click anywhere to close</p>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
