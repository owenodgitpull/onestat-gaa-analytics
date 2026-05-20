/**
 * OnboardingProgress
 * Step indicator bar showing 4 steps with labels.
 * Active step highlighted, completed steps show checkmark.
 */

import { Check } from 'lucide-react';

interface OnboardingProgressProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

const STEPS = [
  { number: 1, label: 'Team Details' },
  { number: 2, label: 'Branding' },
  { number: 3, label: 'Players' },
  { number: 4, label: 'Fixtures' },
  { number: 5, label: 'Review' },
];

export default function OnboardingProgress({ currentStep, onStepClick }: OnboardingProgressProps) {
  return (
    <div className="glass-card p-4 sm:p-6 mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isCompleted = currentStep > step.number;
          const isActive = currentStep === step.number;
          const isClickable = onStepClick && (isCompleted || isActive);

          return (
            <div key={step.number} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(step.number)}
                className={`flex flex-col items-center ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    text-sm font-bold transition-all duration-300 border
                    ${isCompleted
                      ? 'bg-emerald-500/30 border-emerald-400/50 text-emerald-300'
                      : isActive
                        ? 'bg-emerald-500/30 border-emerald-400/50 text-white ring-2 ring-emerald-400/30 ring-offset-2 ring-offset-transparent'
                        : 'bg-white/5 border-white/10 text-white/40'
                    }
                    ${isClickable && !isActive ? 'hover:ring-2 hover:ring-emerald-400/20' : ''}
                  `}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={`
                    mt-2 text-xs font-medium transition-colors duration-300
                    ${isCompleted
                      ? 'text-emerald-300'
                      : isActive
                        ? 'text-white'
                        : 'text-white/40'
                    }
                  `}
                >
                  {step.label}
                </span>
              </button>

              {/* Connector line (not after last step) */}
              {idx < STEPS.length - 1 && (
                <div className="flex-1 mx-3 mt-[-1.25rem]">
                  <div
                    className={`
                      h-0.5 rounded-full transition-all duration-500
                      ${currentStep > step.number
                        ? 'bg-emerald-400/50'
                        : 'bg-white/10'
                      }
                    `}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
