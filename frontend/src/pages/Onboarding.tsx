/**
 * Onboarding Wizard
 * 4-step wizard: Team Details -> Team Branding -> Player Upload -> Review
 * Creates the club via the onboarding API, uploads players, then completes setup.
 *
 * Persistence:
 * - Steps 1-2 (pre-club-creation): form data saved to sessionStorage
 * - Steps 3-4 (post-club-creation): club is in DB, resume via user.club_id
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api, { fetchAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import OnboardingProgress from '../components/onboarding/OnboardingProgress';
import StepClubDetails from '../components/onboarding/StepClubDetails';
import type { ClubData } from '../components/onboarding/StepClubDetails';
import StepClubBranding from '../components/onboarding/StepClubBranding';
import StepPlayerUpload from '../components/onboarding/StepPlayerUpload';
import type { PlayerPreviewRow, ManualPlayer } from '../components/onboarding/StepPlayerUpload';
import StepReview from '../components/onboarding/StepReview';

// ── Initial state ──────────────────────────────────────────────────────────

const INITIAL_CLUB_DATA: ClubData = {
  name: '',
  short_name: '',
  county: '',
  province: '',
  home_ground: '',
  primary_colour: '#1e40af',
  secondary_colour: '#ffffff',
};

const DRAFT_KEY = 'gaa_onboarding_draft';

// ── Component ──────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const resumedRef = useRef(false);

  // ── Compute initial state from draft or backend ──
  const [currentStep, setCurrentStep] = useState(1);
  const [clubId, setClubId] = useState<string | null>(null);
  const [clubData, setClubData] = useState<ClubData>({ ...INITIAL_CLUB_DATA });
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // Player state
  const [playerPreview, setPlayerPreview] = useState<PlayerPreviewRow[]>([]);
  const [manualPlayers, setManualPlayers] = useState<ManualPlayer[]>([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── On mount: restore state from sessionStorage draft OR backend ──
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;

    // Case 1: User already has a club but onboarding not complete → resume at step 3
    if (user?.club_id && !user.onboarding_completed) {
      setClubId(user.club_id);
      setCurrentStep(3);
      sessionStorage.removeItem(DRAFT_KEY);

      // Fetch club data so back-navigation and review show correct info
      fetchAPI<any>('/club')
        .then((club) => {
          setClubData({
            name: club.name || '',
            short_name: club.short_name || '',
            county: club.county || '',
            province: club.province || '',
            home_ground: club.home_ground || '',
            primary_colour: club.primary_colour || '#1e40af',
            secondary_colour: club.secondary_colour || '#ffffff',
          });
        })
        .catch(() => { /* non-blocking */ });
      return;
    }

    // Case 2: No club yet — restore draft from sessionStorage (steps 1-2 form data)
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.data) setClubData(draft.data);
        if (draft.step && draft.step <= 2) setCurrentStep(draft.step);
      }
    } catch { /* ignore corrupt draft */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save draft to sessionStorage whenever form data changes (steps 1-2 only) ──
  const isPreCreation = !clubId;
  useEffect(() => {
    if (isPreCreation) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: currentStep, data: clubData }));
    }
  }, [currentStep, clubData, isPreCreation]);

  // ── Computed values ────────────────────────────────────────────────

  const totalPlayerCount =
    playerPreview.length +
    manualPlayers.length;

  const allPlayers: Array<{
    name: string;
    position?: string;
    jersey_number?: number;
    date_of_birth?: string;
  }> = [
    ...playerPreview.map((p) => ({
      name: p.name,
      position: p.position,
      jersey_number: p.jersey_number,
      date_of_birth: p.date_of_birth,
    })),
    ...manualPlayers.map((p) => ({
      name: p.name,
      position: p.position || undefined,
      jersey_number: p.jersey_number ? parseInt(p.jersey_number, 10) : undefined,
      date_of_birth: p.date_of_birth || undefined,
    })),
  ];

  // ── Validation ─────────────────────────────────────────────────────

  const canProceed = (): boolean => {
    if (currentStep === 1) return clubData.name.trim().length > 0;
    if (currentStep === 2) return true; // branding is optional
    if (currentStep === 3) return true; // players can be added later
    return true;
  };

  // ── Step transitions ───────────────────────────────────────────────

  const handleNext = async () => {
    setError(null);

    // Step 2 -> 3: create the club (or update if already created)
    if (currentStep === 2 && !clubId) {
      setLoading(true);
      try {
        const result = await api.onboarding.createClub({
          name: clubData.name,
          short_name: clubData.short_name || undefined,
          county: clubData.county || undefined,
          province: clubData.province || undefined,
          home_ground: clubData.home_ground || undefined,
          primary_colour: clubData.primary_colour || undefined,
          secondary_colour: clubData.secondary_colour || undefined,
        });
        setClubId(result.id);
        sessionStorage.removeItem(DRAFT_KEY); // Club is persisted on backend now

        // Update auth context so club_id is set (backend links user on create)
        if (user) {
          setUser({ ...user, club_id: result.id, onboarding_completed: false });
        }

        // Upload logo if selected
        if (logoFile) {
          try {
            await api.onboarding.uploadLogo(result.id, logoFile);
          } catch {
            // Non-blocking — logo upload failure should not block onboarding
            console.warn('Logo upload failed, continuing...');
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to create club. Please try again.');
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    setCurrentStep((s) => Math.min(s + 1, 4));
  };

  const handleBack = () => {
    setError(null);
    setCurrentStep((s) => Math.max(s - 1, 1));
  };

  // ── Final confirm (Step 4) ────────────────────────────────────────

  const handleConfirm = async () => {
    if (!clubId) {
      setError('Club has not been created yet. Please go back and try again.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Confirm players if any
      if (allPlayers.length > 0) {
        await api.onboarding.confirmPlayers(clubId, allPlayers);
      }

      // Mark onboarding complete
      await api.onboarding.completeOnboarding(clubId);

      // Ensure user is linked to club (idempotent — may already be linked from create step)
      if (user && !user.club_id) {
        await fetchAPI<any>('/auth/setup-profile', {
          method: 'POST',
          body: JSON.stringify({ club_id: clubId }),
        });
      }

      // Refresh auth tokens so the dashboard has a fresh session
      try {
        await fetchAPI<any>('/auth/refresh', { method: 'POST' });
      } catch {
        // Non-critical — existing token may still be valid
      }

      // Update auth context so the app knows onboarding is done
      if (user) {
        setUser({ ...user, club_id: clubId, onboarding_completed: true });
      }

      sessionStorage.removeItem(DRAFT_KEY);

      // Redirect to dashboard
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to complete setup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background */}
      <div className="app-background">
        <div className="app-bg-orb" />
        <div className="app-bg-shimmer" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-start px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            Set Up Your Team
          </h1>
          <p className="text-white/50 text-sm sm:text-base">
            Get started with OneStat Analytics in just a few steps.
          </p>
        </div>

        {/* Wizard Container */}
        <div className="w-full max-w-2xl">
          {/* Progress Indicator */}
          <OnboardingProgress currentStep={currentStep} onStepClick={(step) => {
            if (step < currentStep) {
              setError(null);
              setCurrentStep(step);
            }
          }} />

          {/* Step Content */}
          <div className="glass-card p-6 sm:p-8">
            {currentStep === 1 && (
              <StepClubDetails data={clubData} onChange={setClubData} />
            )}

            {currentStep === 2 && (
              <StepClubBranding
                data={clubData}
                onChange={setClubData}
                onLogoChange={setLogoFile}
              />
            )}

            {currentStep === 3 && (
              <StepPlayerUpload
                clubId={clubId}
                preview={playerPreview}
                onPreviewChange={setPlayerPreview}
                manualPlayers={manualPlayers}
                onManualPlayersChange={setManualPlayers}
              />
            )}

            {currentStep === 4 && (
              <StepReview
                clubData={clubData}
                playerCount={totalPlayerCount}
                logoFile={logoFile}
                onConfirm={handleConfirm}
                onBack={handleBack}
                loading={loading}
              />
            )}

            {/* Error */}
            {error && (
              <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Navigation Buttons (not shown on step 4 -- it has its own button) */}
            {currentStep < 4 && (
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
                <button
                  onClick={handleBack}
                  disabled={currentStep === 1}
                  className="btn-glass py-2.5 px-5 text-sm flex items-center gap-2
                             disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>

                <button
                  onClick={handleNext}
                  disabled={!canProceed() || loading}
                  className="btn-primary py-2.5 px-5 text-sm flex items-center gap-2
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
