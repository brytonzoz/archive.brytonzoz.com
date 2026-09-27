'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Project, isProjectReleased } from '../lib/utils';

interface ProjectCardProps {
  project: Project;
  className?: string;
  style?: React.CSSProperties;
  onModalStateChange?: (isOpen: boolean) => void;
  imageAspectRatio?: number;
}

// Streaming service configuration with local images
const streamingServices = {
  applemusic: {
    name: 'Apple Music',
    image: '/images/Apple Music iOS App Logo.jpg'
  },
  spotify: {
    name: 'Spotify',
    image: '/images/Spotify Music Logo July 30 2015.webp'
  },
  youtubemusic: {
    name: 'YouTube Music',
    image: '/images/YouTube Music Logo.png'
  }
};

// Enhanced color schemes with sophisticated depth and precedence
const getProjectColors = (projectName: string, type: string) => {
  if (type === "album") {
    return {
      gradient: "from-amber-500/10 via-yellow-500/8 to-orange-500/10",
      hoverGradient: "group-hover:from-amber-500/25 group-hover:via-yellow-500/20 group-hover:to-orange-500/25",
      accent: "text-amber-300",
      badge: "bg-amber-500/12 border-amber-400/20 text-amber-200",
      glow: "group-hover:shadow-amber-500/15",
      shadowColor: "shadow-amber-500/10"
    };
  } else if (type === "streaming-ep") {
    return {
      gradient: "from-pink-500/10 via-purple-500/8 to-blue-500/10",
      hoverGradient: "group-hover:from-pink-500/25 group-hover:via-purple-500/20 group-hover:to-blue-500/25",
      accent: "text-pink-300",
      badge: "bg-pink-500/12 border-pink-400/20 text-pink-200",
      glow: "group-hover:shadow-pink-500/15",
      shadowColor: "shadow-pink-500/10"
    };
  } else if (type === "mixtape") {
    return {
      gradient: "from-purple-500/10 via-violet-500/8 to-fuchsia-500/10",
      hoverGradient: "group-hover:from-purple-500/25 group-hover:via-violet-500/20 group-hover:to-fuchsia-500/25",
      accent: "text-purple-300",
      badge: "bg-purple-500/12 border-purple-400/20 text-purple-200",
      glow: "group-hover:shadow-purple-500/15",
      shadowColor: "shadow-purple-500/10"
    };
  } else if (type === "multi-purpose-stream") {
    return {
      gradient: "from-blue-500/10 via-cyan-500/8 to-teal-500/10",
      hoverGradient: "group-hover:from-blue-500/25 group-hover:via-cyan-500/20 group-hover:to-teal-500/25",
      accent: "text-blue-300",
      badge: "bg-blue-500/12 border-blue-400/20 text-blue-200",
      glow: "group-hover:shadow-blue-500/15",
      shadowColor: "shadow-blue-500/10"
    };
  } else if (type === "video-series") {
    return {
      gradient: "from-orange-500/10 via-red-500/8 to-pink-500/10",
      hoverGradient: "group-hover:from-orange-500/25 group-hover:via-red-500/20 group-hover:to-pink-500/25",
      accent: "text-orange-300",
      badge: "bg-orange-500/12 border-orange-400/20 text-orange-200",
      glow: "group-hover:shadow-orange-500/15",
      shadowColor: "shadow-orange-500/10"
    };
  } else {
    return {
      gradient: "from-green-500/10 via-emerald-500/8 to-teal-500/10",
      hoverGradient: "group-hover:from-green-500/25 group-hover:via-emerald-500/20 group-hover:to-teal-500/25",
      accent: "text-green-300",
      badge: "bg-green-500/12 border-green-400/20 text-green-200",
      glow: "group-hover:shadow-green-500/15",
      shadowColor: "shadow-green-500/10"
    };
  }
};

// Streaming Modal Component
export const StreamingModal = ({
  project,
  isOpen,
  onClose
}: {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
}) => {
  if (!isOpen) return null;

  const isReleased = isProjectReleased(project);
  const currentStreamingLinks = isReleased ?
    (project.postReleaseStreamingLinks || project.streamingLinks) :
    project.streamingLinks;

  if (!currentStreamingLinks) return null;

  // For pre-release, show all potential services but only enable Apple Music
  const allServices = ['applemusic', 'spotify', 'youtubemusic'];
  const services = allServices.map(key => {
    const url = currentStreamingLinks[key as keyof typeof currentStreamingLinks];
    const serviceInfo = streamingServices[key as keyof typeof streamingServices];
    const isEnabled = isReleased || key === 'applemusic'; // Only Apple Music enabled pre-release

    return {
      key,
      url: isEnabled ? url : undefined,
      isEnabled,
      ...serviceInfo
    };
  }).filter(service => service.url || !isReleased); // Show all services pre-release, only available ones post-release

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Ultra-Enhanced Full-Screen Backdrop with Maximum Blur */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-3xl"
        onClick={onClose}
        style={{
          backdropFilter: 'blur(60px) saturate(200%)',
          WebkitBackdropFilter: 'blur(60px) saturate(200%)'
        }}
      />

      {/* Modal Content - Simplified */}
      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute -top-16 right-4 text-white/90 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Slimmer Flying Containers - Closer Together */}
        <div className="space-y-4">
          {services.map((service, index) => (
            <div
              key={service.key}
              className={`
                animate-in slide-in-from-bottom-8 fade-in-0 duration-500
                ${index === 0 ? 'delay-100' : index === 1 ? 'delay-200' : 'delay-300'}
              `}
            >
              {service.isEnabled && service.url ? (
                <Link
                  href={service.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="
                    group flex items-center justify-between py-5 px-6
                    bg-white/15 hover:bg-white/25
                    backdrop-blur-xl border border-white/30
                    rounded-2xl transition-all duration-300
                    hover:scale-105 hover:shadow-2xl hover:shadow-white/20
                    transform-gpu focus:outline-none focus:ring-0
                  "
                  style={{
                    backdropFilter: 'blur(30px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(30px) saturate(180%)'
                  }}
                >
                  {/* Service Name */}
                  <span className="text-white font-semibold text-lg">
                    {service.name}
                  </span>

                  {/* Right Side Content */}
                  <div className="flex items-center space-x-4">
                    {/* Circular Logo */}
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-white/30 p-1 ring-1 ring-white/20">
                      <Image
                        src={service.image}
                        alt={service.name}
                        width={48}
                        height={48}
                        className="w-full h-full object-cover rounded-full"
                      />
                    </div>

                    {/* Arrow */}
                    <svg
                      className="w-6 h-6 text-white/80 group-hover:text-white group-hover:translate-x-2 transition-all duration-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 6L8 4l6 8-6 8 2-2 4-6-4-6z" />
                    </svg>
                  </div>
                </Link>
              ) : (
                <div className="
                  flex items-center justify-between py-5 px-6
                  bg-white/5 backdrop-blur-xl border border-white/10
                  rounded-2xl transition-all duration-300
                  opacity-50 cursor-not-allowed
                "
                style={{
                  backdropFilter: 'blur(30px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(30px) saturate(180%)'
                }}
                >
                  {/* Service Name */}
                  <span className="text-white/70 font-semibold text-lg">
                    {service.name}
                  </span>

                  {/* Right Side Content */}
                  <div className="flex items-center space-x-4">
                    {/* Circular Logo */}
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-white/20 p-1 ring-1 ring-white/10">
                      <Image
                        src={service.image}
                        alt={service.name}
                        width={48}
                        height={48}
                        className="w-full h-full object-cover rounded-full opacity-60"
                      />
                    </div>

                    {/* Lock Icon Instead of Arrow for disabled services */}
                    <svg
                      className="w-6 h-6 text-white/40"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SolenyaCard = ({
  project,
  className = '',
  style,
}: {
  project: Project;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const isReleased = isProjectReleased(project);
  const currentDescription = isReleased ?
    (project.postReleaseDescription || project.description) :
    (project.preReleaseDescription || project.description);
  const currentStreamingLinks = isReleased ?
    (project.postReleaseStreamingLinks || project.streamingLinks) :
    project.streamingLinks;
  const primaryActionUrl =
    currentStreamingLinks?.applemusic ||
    currentStreamingLinks?.spotify ||
    currentStreamingLinks?.youtubemusic ||
    project.url;

  return (
    <div
      className={`
        relative mx-auto overflow-hidden rounded-[56px]
        bg-[#2A130D]
        px-3 pb-3 pt-3 sm:px-3.5 sm:pb-4 sm:pt-3.5
        shadow-[0_36px_110px_rgba(22,8,8,0.45)]
        ${className}
      `}
      style={style}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(0,0,0,0.22),transparent_40%)]" />

      <div className="relative z-10 flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-[28px] aspect-square shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <Image
            src={project.image || ''}
            alt={project.name}
            fill
            priority
            sizes="(max-width: 640px) calc(100vw - 190px), 260px"
            className="object-cover object-center"
          />
        </div>

        <div className="space-y-1 px-2 text-white">
          <h3 className="text-[1.65rem] font-black uppercase tracking-[-0.05em] leading-none sm:text-[1.9rem]">
            {project.name}
          </h3>
          <p className="max-w-none whitespace-nowrap text-[0.76rem] leading-none text-white/84 sm:text-[0.86rem]">
            {currentDescription}
          </p>
        </div>

        {primaryActionUrl ? (
          <Link
            href={primaryActionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="
              group/listen mt-1 flex items-center justify-between rounded-[28px]
              bg-[#C7937F] px-4 py-3 text-white
              transition-transform duration-500 hover:-translate-y-0.5
              sm:px-5 sm:py-3.5
            "
          >
            <span className="text-[0.9rem] font-semibold tracking-[-0.04em] sm:text-[1rem]">
              Listen Now
            </span>
            <svg
              className="h-7 w-7 transition-transform duration-500 group-hover/listen:translate-x-1 sm:h-8 sm:w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M5 12h14m-5-5 5 5-5 5" />
            </svg>
          </Link>
        ) : null}
      </div>
    </div>
  );
};

// Card Content Component
const CardContent = ({ project, colors, imageAspectRatio = 16/9 }: { project: Project; colors: any; imageAspectRatio?: number }) => {
  const isReleased = isProjectReleased(project);
  const currentDescription = isReleased ?
    (project.postReleaseDescription || project.description) :
    (project.preReleaseDescription || project.description);
  const currentStreamingLinks = isReleased ?
    (project.postReleaseStreamingLinks || project.streamingLinks) :
    project.streamingLinks;

  return (
    <>
      {/* Image Container */}
      <div
        className="relative rounded-xl overflow-hidden mb-4"
        style={{
          aspectRatio: `${imageAspectRatio}`,
          minHeight: '200px'
        }}
      >
        <Image
          src={project.image || `/og/${project.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.png`}
          alt={project.name}
          fill
          className="object-cover object-top group-hover:scale-105 transition-transform duration-700"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `/og/archive-music.png`;
          }}
        />
        <div className={`absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60 group-hover:opacity-40 transition-opacity duration-500`} />
      </div>

      {/* Content */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white/90 group-hover:text-white transition-colors duration-300">
          {project.name}
        </h3>

        <p className="text-sm text-white/60 group-hover:text-white/80 transition-colors duration-300 leading-relaxed">
          {currentDescription}
        </p>

      {/* Refined Tags */}
      <div className="flex flex-wrap gap-1.5">
        {project.type && !project.type.includes('streaming-ep') && !project.type.includes('album') && (
          <span className={`px-2 py-1 text-xs rounded-full border backdrop-blur-sm ${colors.badge}`}>
            {project.type.replace(/-/g, ' ')}
          </span>
        )}
        {project.highlight && (
          <span className={`px-2 py-1 text-xs rounded-full border backdrop-blur-sm ${colors.badge}`}>
            {project.highlight}
          </span>
        )}
        {/* Streaming Platform Tags */}
        {currentStreamingLinks && (
          <>
            {currentStreamingLinks.applemusic && (
              <span className="px-2 py-1 text-xs rounded-full border backdrop-blur-sm bg-pink-500/12 border-pink-400/20 text-pink-200">
                Apple Music
              </span>
            )}
            {currentStreamingLinks.spotify && (
              <span className="px-2 py-1 text-xs rounded-full border backdrop-blur-sm bg-green-500/12 border-green-400/20 text-green-200">
                Spotify
              </span>
            )}
            {currentStreamingLinks.youtubemusic && (
              <span className="px-2 py-1 text-xs rounded-full border backdrop-blur-sm bg-red-500/12 border-red-400/20 text-red-200">
                YouTube Music
              </span>
            )}
          </>
        )}
        </div>
      </div>
    </>
  );
};

export function ProjectCard({ project, className = '', style, onModalStateChange, imageAspectRatio = 16/9 }: ProjectCardProps) {
  const [isStreamingModalOpen, setIsStreamingModalOpen] = useState(false);
  const isSolenya = project.name === 'SOLENYA';
  const colors = getProjectColors(project.name, project.type);
  const isReleased = isProjectReleased(project);
  const currentStreamingLinks = isReleased ?
    (project.postReleaseStreamingLinks || project.streamingLinks) :
    project.streamingLinks;

  if (isSolenya) {
    return <SolenyaCard project={project} className={className} style={style} />;
  }

  const handleCardClick = () => {
    if (currentStreamingLinks) {
      setIsStreamingModalOpen(true);
      onModalStateChange?.(true);
    } else if (project.url) {
      window.open(project.url, '_blank');
    }
  };

  const handleModalClose = () => {
    setIsStreamingModalOpen(false);
    onModalStateChange?.(false);
  };

  return (
    <>
      <div
        className={`
          group relative overflow-hidden rounded-2xl p-6 cursor-pointer
          bg-gradient-to-br ${colors.gradient} ${colors.hoverGradient}
          border border-white/10 backdrop-blur-xl
          hover:border-white/20 transition-all duration-500
          hover:shadow-2xl ${colors.glow} hover:-translate-y-1
          ${className}
        `}
        style={style}
        onClick={handleCardClick}
      >
        {/* Glass overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <CardContent project={project} colors={colors} imageAspectRatio={imageAspectRatio} />

        {/* Large Call-to-Action Button */}
        <div className="mt-6">
          <div className="
            flex items-center justify-center space-x-2
            py-3 px-4 rounded-xl
            bg-white/10 group-hover:bg-white/20
            border border-white/20 group-hover:border-white/30
            transition-all duration-300
            text-white/80 group-hover:text-white
          ">
            <span className="font-medium">
              {currentStreamingLinks ? (isReleased ? 'Listen' : 'Presave') : 'Visit'}
            </span>
            <svg
              className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Streaming Modal */}
      <StreamingModal
        project={project}
        isOpen={isStreamingModalOpen}
        onClose={handleModalClose}
      />
    </>
  );
}
