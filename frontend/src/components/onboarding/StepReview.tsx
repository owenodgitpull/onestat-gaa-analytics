/**
 * StepReview
 * Summary card showing club name, county, home ground, colour swatches, player count.
 * "Complete Setup" button triggers the final onboarding completion.
 */

import { Shield, MapPin, Users, Loader2, Check, ChevronLeft } from 'lucide-react';

interface ClubData {
  name: string;
  short_name: string;
  county: string;
  province: string;
  home_ground: string;
  primary_colour: string;
  secondary_colour: string;
}

interface StepReviewProps {
  clubData: ClubData;
  playerCount: number;
  logoFile: File | null;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
}

export default function StepReview({ clubData, playerCount, logoFile, onConfirm, onBack, loading }: StepReviewProps) {
  const primary = clubData.primary_colour || '#1e40af';
  const secondary = clubData.secondary_colour || '#ffffff';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Review & Confirm</h2>
        <p className="text-white/50 text-sm">
          Everything look good? You can always change these later.
        </p>
      </div>

      {/* Summary Card */}
      <div className="glass-card p-6 space-y-6">
        {/* Club Name + Badge */}
        <div className="flex items-center gap-4">
          {logoFile ? (
            <img
              src={URL.createObjectURL(logoFile)}
              alt="Club logo"
              className="w-16 h-16 rounded-full object-cover border-2 flex-shrink-0"
              style={{ borderColor: secondary }}
            />
          ) : (
            <div
              className="w-16 h-16 rounded-full border-3 flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: primary, borderColor: secondary, borderWidth: '3px' }}
            >
              <span className="text-base font-bold" style={{ color: secondary }}>
                {clubData.short_name?.slice(0, 3).toUpperCase() || clubData.name?.slice(0, 3).toUpperCase() || '?'}
              </span>
            </div>
          )}
          <div>
            <h3 className="text-xl font-bold text-white">{clubData.name || 'Unnamed Club'}</h3>
            {clubData.short_name && (
              <p className="text-sm text-white/40">{clubData.short_name}</p>
            )}
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* County & Province */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
            <Shield className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-white/40 font-medium uppercase tracking-wider">County</p>
              <p className="text-sm text-white mt-0.5">
                {clubData.county || 'Not set'}
                {clubData.province && (
                  <span className="text-white/40"> ({clubData.province})</span>
                )}
              </p>
            </div>
          </div>

          {/* Home Ground */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
            <MapPin className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Home Ground</p>
              <p className="text-sm text-white mt-0.5">{clubData.home_ground || 'Not set'}</p>
            </div>
          </div>

          {/* Colours */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="flex gap-1.5 mt-0.5 flex-shrink-0">
              <div
                className="w-5 h-5 rounded-full border border-white/20"
                style={{ backgroundColor: primary }}
              />
              <div
                className="w-5 h-5 rounded-full border border-white/20"
                style={{ backgroundColor: secondary }}
              />
            </div>
            <div>
              <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Club Colours</p>
              <p className="text-sm text-white mt-0.5 font-mono">
                {primary.toUpperCase()} / {secondary.toUpperCase()}
              </p>
            </div>
          </div>

          {/* Player Count */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
            <Users className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-white/40 font-medium uppercase tracking-wider">Players</p>
              <p className="text-sm text-white mt-0.5">
                {playerCount} player{playerCount !== 1 ? 's' : ''} added
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between mt-2 pt-6 border-t border-white/10">
        <button
          onClick={onBack}
          disabled={loading}
          className="btn-glass py-2.5 px-5 text-sm flex items-center gap-2
                     disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>

        <button
          onClick={onConfirm}
          disabled={loading}
          className="btn-primary py-2.5 px-5 text-sm flex items-center gap-2
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Setting up...
            </>
          ) : (
            <>
              <Check className="w-5 h-5" />
              Complete Setup
            </>
          )}
        </button>
      </div>
    </div>
  );
}
