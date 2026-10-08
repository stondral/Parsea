import React from 'react'
import { TRPCProvider } from '@/trpc/Provider'
import './styles.css'
import './theme.css'

export const metadata = {
  description: 'Parsea — AI-powered academic assistant for organised, intelligent study',
  title: 'Parsea',
  icons: {
    icon: 'https://img.icons8.com/bubbles/100/learning.png',
    apple: 'https://img.icons8.com/bubbles/100/learning.png',
  },
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <head>
        {/* Load Manrope once, with a system fallback while Google Fonts responds. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <TRPCProvider>
          <main>{children}</main>
        </TRPCProvider>
      </body>
    </html>
  )
}
