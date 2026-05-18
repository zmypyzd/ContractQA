'use client';

import { useEffect, useState, useTransition } from 'react';
import { listDirectory, type DirectoryListing } from './actions';
import s from './folderPicker.module.css';

interface Props {
  initialPath: string;
  onSelect: (absolutePath: string) => void;
  onCancel: () => void;
}

export function FolderPicker({ initialPath, onSelect, onCancel }: Props) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [isLoading, startTransition] = useTransition();

  const load = (path: string) => {
    startTransition(async () => {
      const r = await listDirectory(path);
      if (r.ok) {
        setListing(r);
        setError(null);
      } else {
        setError(r.error);
      }
    });
  };

  useEffect(() => {
    load(initialPath || '~');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const breadcrumbSegments = listing
    ? listing.path.split('/').filter(Boolean).map((seg, i, arr) => ({
        name: seg,
        path: '/' + arr.slice(0, i + 1).join('/'),
      }))
    : [];

  const visibleEntries = listing
    ? listing.entries.filter((e) => showHidden || !e.isHidden)
    : [];

  return (
    <div className={s.backdrop} onClick={onCancel} role="dialog" aria-modal="true" aria-label="Folder picker">
      <div className={s.panel} onClick={(e) => e.stopPropagation()}>
        <header className={s.head}>
          <h3>Pick a project folder</h3>
          <button type="button" className={s.closeBtn} onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>

        <div className={s.crumbs}>
          <button type="button" className={s.crumb} onClick={() => load('/')}>
            /
          </button>
          {breadcrumbSegments.map((seg) => (
            <span key={seg.path} className={s.crumbWrap}>
              <span className={s.sep}>/</span>
              <button type="button" className={s.crumb} onClick={() => load(seg.path)}>
                {seg.name}
              </button>
            </span>
          ))}
        </div>

        <div className={s.toolbar}>
          <button
            type="button"
            className={s.smallBtn}
            disabled={!listing?.parent}
            onClick={() => listing?.parent && load(listing.parent)}
            title="Go up one level"
          >
            ↑ Up
          </button>
          <button type="button" className={s.smallBtn} onClick={() => load(process.env.NEXT_PUBLIC_HOME ?? '~')}>
            ⌂ Home
          </button>
          <label className={s.hiddenToggle}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show hidden
          </label>
          <span className={s.status}>
            {isLoading ? 'Loading…' : `${visibleEntries.length} folders`}
          </span>
        </div>

        <div className={s.list}>
          {error && <p className={s.error}>{error}</p>}
          {!error && visibleEntries.length === 0 && !isLoading && (
            <p className={s.empty}>No subfolders here.</p>
          )}
          {visibleEntries.map((e) => {
            const childPath = listing!.path === '/' ? `/${e.name}` : `${listing!.path}/${e.name}`;
            return (
              <button
                key={e.name}
                type="button"
                className={`${s.entry} ${e.isHidden ? s.entryHidden : ''}`}
                onClick={() => load(childPath)}
                onDoubleClick={() => {
                  onSelect(childPath);
                }}
              >
                <span className={s.entryIcon}>▸</span>
                <span className={s.entryName}>{e.name}</span>
              </button>
            );
          })}
        </div>

        <footer className={s.foot}>
          <code className={s.currentPath}>{listing?.path ?? '—'}</code>
          <div className={s.footActions}>
            <button type="button" className={s.smallBtn} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={`${s.smallBtn} ${s.primaryBtn}`}
              disabled={!listing}
              onClick={() => listing && onSelect(listing.path)}
            >
              Select this folder
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
