import React from 'react'
import { TRPCProvider } from '@/trpc/Provider'
import './styles.css'

export const metadata = {
  description: 'Parsea — AI-powered academic assistant for organised, intelligent study',
  title: 'Parsea',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <head>
        {/* Inter loaded at the HTML level so it applies before first paint */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
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
