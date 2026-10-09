import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { motionVariables } from '../lib/scene-motion'
import { PlayerProvider } from '../components/player/PlayerProvider'
import { PageViews } from '../components/PageViews'
import { ServiceWorker } from '../components/ServiceWorker'
import { ArtistJsonLd } from '../components/ArtistJsonLd'
import shareImages from '../lib/share-images.json'
import { ARTIST } from '../lib/artist'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

// How the site shows up in search and link previews: the story is in lib/artist.ts.
const TITLE = `${ARTIST.name} — ${ARTIST.headline}`
const DESCRIPTION = ARTIST.description

export const metadata: Metadata = {
  metadataBase: new URL('https://brytonzoz.com'),
  title: {
    default: TITLE,
    template: '%s - Bryton Zoz',
  },
  description: DESCRIPTION,
  keywords: [
    'Bryton Zoz', 'brytonzoz', 'New York artist', 'NYC artist', 'independent artist', 'musician', 'music producer',
    'fashion designer', 'designer', 'creative', 'upcycled clothing', 'one of one clothing', 'Scrapwrk', 'NonParallel',
    'SOLENYA', 'CAUTION', 'Just A Reminder To Live Life',
  ],
  authors: [{ name: 'Bryton Zoz', url: 'https://brytonzoz.com' }],
  creator: 'Bryton Zoz',
  publisher: 'Bryton Zoz',
  category: 'music',
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://brytonzoz.com',
    siteName: 'Bryton Zoz',
    type: 'profile',
    locale: 'en_US',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Bryton Zoz, New York artist, musician and designer' }],
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@BrytonZoz',
    site: '@BrytonZoz',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    // Let search and AI results show full snippets and large image previews.
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large', 'max-video-preview': -1 },
  },
  icons: {
    icon: [{ url: shareImages.icons['32'], sizes: '32x32', type: 'image/png' }],
    apple: [{ url: shareImages.icons['180'], sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    title: 'Bryton Zoz',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'mobile-web-app-capable': 'yes',
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
    <html lang="en" className="dark" style={motionVariables as React.CSSProperties}>
      <body className={`${inter.variable} font-body antialiased`}>
        <ArtistJsonLd />
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