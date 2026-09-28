import React from 'react';
import Link from 'next/link';
import { ProjectCard } from './ProjectCard';
import { SiteFooter } from './SiteFooter';
import type { Project } from '../lib/utils';

export function CatalogPage({ title, projects }: { title: string; projects: Project[] }) {
  return (
    <main className="min-h-screen bg-[#0b0b0c] text-white">
      <div
        className="mx-auto max-w-4xl px-5 pt-6 sm:px-8 sm:pt-10"
        style={{ paddingBottom: '1rem' }}
      >
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-[13px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Bryton Zoz
        </Link>

        <h1 className="mt-8 text-[34px] font-bold leading-none tracking-[-0.03em] sm:mt-12 sm:text-[44px]">
          {title}
        </h1>

        <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-7 sm:mt-10 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-10">
          {projects.map((project, index) => (
            <ProjectCard
              key={project.name}
              project={project}
              className="catalog-enter"
              style={{ animationDelay: `${index * 70}ms` }}
            />
          ))}
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
