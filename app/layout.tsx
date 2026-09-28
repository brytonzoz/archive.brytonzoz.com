import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { PlayerProvider } from '../components/player/PlayerProvider'
import { PageViews } from '../components/PageViews'
import { ServiceWorker } from '../components/ServiceWorker'
import shareImages from '../lib/share-images.json'
import { artistJsonLd, jsonLdScript } from '../lib/artist'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

const TITLE = 'Bryton Zoz — Artist, Producer & Designer'
const DESCRIPTION = 'Music by Bryton Zoz: the album SOLENYA, the EP CAUTION and the mixtape Just A Reminder To Live Life. Listen on Spotify, Apple Music and YouTube Music.'

export const metadata: Metadata = {
  metadataBase: new URL('https://brytonzoz.com'),
  title: {
    default: TITLE,
    template: '%s - Bryton Zoz',
  },
  description: DESCRIPTION,
  keywords: 'Bryton Zoz, music, artist, producer, SOLENYA, CAUTION, Just A Reminder To Live Life',
  authors: [{ name: 'Bryton Zoz' }],
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://brytonzoz.com',
    siteName: 'Bryton Zoz',
    type: 'website',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Bryton Zoz: new project soon' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.jpg'],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: shareImages.icons['32'], sizes: '32x32', type: 'image/png' }],
    apple: [{ url: shareImages.icons['180'], sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Bryton Zoz',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-body antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(artistJsonLd()) }}
        />
        <PageViews />
        <ServiceWorker />
        <PlayerProvider>
          <div className="min-h-screen bg-black overflow-x-hidden">
            <main className="relative">
              {children}
            </main>
          </div>
        </PlayerProvider>
      </body>
    </html>
  )
} 