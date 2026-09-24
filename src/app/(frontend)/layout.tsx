import React from 'react'
import { TRPCProvider } from '@/trpc/Provider'
import './styles.css'

export const metadata = {
  description: 'Parsea Academic Assistant powered by Next.js, Payload, and pgvector',
  title: 'Parsea Academic Assistant',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <TRPCProvider>
          <main>{children}</main>
        </TRPCProvider>
      </body>
    </html>
  )
}
