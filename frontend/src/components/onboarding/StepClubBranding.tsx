/**
 * StepClubBranding
 * Colour pickers (primary + secondary), logo upload with preview,
 * and a mini jersey/badge mockup.
 */

import { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, X } from 'lucide-react';

interface ClubData {
  name: string;
  short_name: string;
  county: string;
  province: string;
  home_ground: string;
  primary_colour: string;
  secondary_colour: string;
}

interface StepClubBrandingProps {
  data: ClubData;
  onChange: (data: ClubData) => void;
  onLogoChange: (file: File | null) => void;
}

export default function StepClubBranding({ data, onChange, onLogoChange }: StepClubBrandingProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const handleColourChange = (field: 'primary_colour' | 'secondary_colour', value: string) => {
    onChange({ ...data, [field]: value });
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    onLogoChange(file);

    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => {
    setLogoPreview(null);
    onLogoChange(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const primary = data.primary_colour || '#1e40af';
  const secondary = data.secondary_colour || '#ffffff';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Club Branding</h2>
        <p className="text-white/50 text-sm">Set your club colours and upload a logo.</p>
      </div>

      {/* Colour Pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Primary Colour */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1.5">
            Primary Colour
          </label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="color"
                value={primary}
                onChange={(e) => handleColourChange('primary_colour', e.target.value)}
                className="w-12 h-12 rounded-lg cursor-pointer border border-white/10 bg-transparent"
              />
            </div>
            <input
              type="text"
              value={primary}
              onChange={(e) => handleColourChange('primary_colour', e.target.value)}
              className="input-glass flex-1 uppercase font-mono text-sm"
              maxLength={7}
            />
          </div>
        </div>

        {/* Secondary Colour */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1.5">
            Secondary Colour
          </label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="color"
                value={secondary}
                onChange={(e) => handleColourChange('secondary_colour', e.target.value)}
                className="w-12 h-12 rounded-lg cursor-pointer border border-white/10 bg-transparent"
              />
            </div>
            <input
              type="text"
              value={secondary}
              onChange={(e) => handleColourChange('secondary_colour', e.target.value)}
              className="input-glass flex-1 uppercase font-mono text-sm"
              maxLength={7}
            />
          </div>
        </div>
      </div>

      {/* Jersey / Badge Mockup */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-3">
          Colour Preview
        </label>
        <div className="glass-card p-6 flex items-center justify-center gap-8">
          {/* Jersey mockup */}
          <div className="flex flex-col items-center gap-2">
            <svg width="100" height="120" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Jersey body */}
              <path
                d="M25 30 L5 45 L5 55 L20 50 L20 110 L80 110 L80 50 L95 55 L95 45 L75 30 L65 15 L35 15 Z"
                fill={primary}
                stroke={secondary}
                strokeWidth="2"
              />
              {/* Collar */}
              <path
                d="M35 15 Q50 25 65 15"
                fill="none"
                stroke={secondary}
                strokeWidth="2"
              />
              {/* Horizontal stripe */}
              <rect x="20" y="55" width="60" height="15" fill={secondary} opacity="0.5" />
              {/* Number */}
              <text
                x="50"
                y="85"
                textAnchor="middle"
                fill={secondary}
                fontSize="24"
                fontWeight="bold"
                fontFamily="sans-serif"
              >
                1
              </text>
            </svg>
            <span className="text-xs text-white/50">Jersey</span>
          </div>

          {/* Badge mockup */}
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-20 h-20 rounded-full border-4 flex items-center justify-center"
              style={{ backgroundColor: primary, borderColor: secondary }}
            >
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="Club logo"
                  className="w-14 h-14 rounded-full object-cover"
                />
              ) : (
                <span
                  className="text-lg font-bold"
                  style={{ color: secondary }}
                >
                  {data.short_name?.slice(0, 3).toUpperCase() || data.name?.slice(0, 3).toUpperCase() || 'CLB'}
                </span>
              )}
            </div>
            <span className="text-xs text-white/50">Badge</span>
          </div>
        </div>
      </div>

      {/* Logo Upload */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">
          Club Logo
        </label>
        {logoPreview ? (
          <div className="glass-card p-4 flex items-center gap-4">
            <img
              src={logoPreview}
              alt="Logo preview"
              className="w-16 h-16 rounded-xl object-cover border border-white/10"
            />
            <div className="flex-1">
              <p className="text-sm text-white/70">Logo uploaded</p>
              <p className="text-xs text-white/40 mt-0.5">Click remove to change</p>
            </div>
            <button
              onClick={clearLogo}
              className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 transition-all duration-200"
            >
              <X className="w-4 h-4 text-white/70 hover:text-red-300" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full glass-card p-8 flex flex-col items-center gap-3
                       hover:border-emerald-400/30 transition-all duration-300 cursor-pointer group"
          >
            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center
                            group-hover:bg-emerald-500/20 transition-colors duration-300">
              <ImageIcon className="w-6 h-6 text-white/40 group-hover:text-emerald-300 transition-colors" />
            </div>
            <div className="text-center">
              <p className="text-sm text-white/60 group-hover:text-white/80 transition-colors">
                Click to upload club logo
              </p>
              <p className="text-xs text-white/30 mt-1">PNG, JPG, SVG up to 2MB</p>
            </div>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleLogoSelect}
          className="hidden"
        />
      </div>
    </div>
  );
}
