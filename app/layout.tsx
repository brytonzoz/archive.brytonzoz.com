import React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://brytonzoz.com'),
  title: 'Bryton Zoz - Creative Projects',
  description: 'Find music and fashion creative projects by Bryton',
  keywords: 'Bryton Zoz, music, fashion, creative, archive',
  authors: [{ name: 'Bryton' }],
  openGraph: {
    title: 'Bryton Zoz - Creative Projects',
    description: 'Find music and fashion creative projects by Bryton',
    url: 'https://brytonzoz.com',
    siteName: 'Bryton Zoz',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bryton Zoz - Creative Projects',
    description: 'Find music and fashion creative projects by Bryton',
  },
  robots: {
    index: true,
    follow: true,
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-body antialiased`}>
        <div className="min-h-screen bg-black overflow-x-hidden">
          <main className="relative">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
} 