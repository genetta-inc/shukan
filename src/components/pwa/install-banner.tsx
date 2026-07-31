'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { detectPlatform, type PwaPlatform } from '@/lib/pwa/platform';
import { shouldShowInstallBanner } from '@/lib/pwa/banner';
import { readDismissedAt, writeDismissedAt } from '@/lib/pwa/dismissal';
import type { BeforeInstallPromptEvent } from '@/lib/pwa/types';
import { IosInstallInstructions } from './ios-install-instructions';
import { AndroidInstallButton } from './android-install-button';

interface InstallBannerProps {
  /** True only on the render right after a habit transitioned to completed. */
  justCompleted: boolean;
  /** Lets the parent reset its trigger flag once the user dismisses. */
  onDismiss?: () => void;
}

/**
 * Non-modal install banner pinned above the BottomNav.
 *
 * All visibility logic lives in pure functions (detectPlatform /
 * shouldShowInstallBanner). This component only resolves browser APIs at mount
 * and renders. It never blocks user interaction.
 */
export function InstallBanner({ justCompleted, onDismiss }: InstallBannerProps) {
  const t = useTranslations('pwa');
  const [platform, setPlatform] = useState<PwaPlatform>('other');
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Resolve navigator / matchMedia / localStorage once on mount.
  useEffect(() => {
    const ua = navigator.userAgent;
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari legacy flag
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // Intentional mount-time sync: navigator/matchMedia/localStorage only exist
    // on the client, so platform & dismissal must be resolved after hydration.
    // Lazy useState init would run during SSR and cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detectPlatform(ua, !!isStandalone));
    setDismissedAt(readDismissedAt(window.localStorage));
  }, []);

  // Capture the Android/Chromium install prompt (don't persist).
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const visible = shouldShowInstallBanner({
    platform,
    dismissedAt,
    now: new Date(),
    justCompleted,
  });

  if (!visible) return null;

  const handleDismiss = () => {
    writeDismissedAt(window.localStorage, new Date());
    setDismissedAt(new Date().toISOString());
    onDismiss?.();
  };

  return (
    <Card className="relative gap-3 border-primary/30 bg-card p-4 shadow-md">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('dismiss')}
        className="absolute right-3 top-3 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
      <p className="pr-6 text-sm font-semibold">{t('banner.title')}</p>
      {platform === 'ios-safari' ? (
        <IosInstallInstructions />
      ) : (
        <AndroidInstallButton
          deferredPrompt={deferredPrompt}
          onPrompted={() => setDeferredPrompt(null)}
        />
      )}
    </Card>
  );
}
