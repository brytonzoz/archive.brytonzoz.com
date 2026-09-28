import React from 'react';
import Link from 'next/link';
import { ProjectCard } from './ProjectCard';
import type { Project } from '../lib/utils';

export function CatalogPage({ title, projects }: { title: string; projects: Project[] }) {
  return (
    <main className="min-h-screen bg-[#0b0b0c] text-white">
      <div
        className="mx-auto max-w-4xl px-5 pt-8 sm:px-8 sm:pt-12"
        style={{ paddingBottom: 'calc(6rem + var(--player-offset, 0px))' }}
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

        <h1 className="mt-10 text-[40px] font-semibold leading-none tracking-[-0.035em] sm:mt-14 sm:text-[56px]">
          {title}
        </h1>

        <div className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2">
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
    </main>
  );
}
