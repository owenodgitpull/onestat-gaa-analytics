/**
 * StepClubDetails
 * Form fields: name, short_name, county, province (auto-filled), home_ground
 */

interface ClubData {
  name: string;
  short_name: string;
  county: string;
  province: string;
  home_ground: string;
  primary_colour: string;
  secondary_colour: string;
}

interface StepClubDetailsProps {
  data: ClubData;
  onChange: (data: ClubData) => void;
}

const COUNTIES = [
  'Antrim', 'Armagh', 'Carlow', 'Cavan', 'Clare', 'Cork', 'Derry', 'Donegal',
  'Down', 'Dublin', 'Fermanagh', 'Galway', 'Kerry', 'Kildare', 'Kilkenny',
  'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath',
  'Monaghan', 'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Tyrone',
  'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
];

const PROVINCE_MAP: Record<string, string> = {
  Antrim: 'Ulster', Armagh: 'Ulster', Cavan: 'Ulster', Derry: 'Ulster',
  Donegal: 'Ulster', Down: 'Ulster', Fermanagh: 'Ulster', Monaghan: 'Ulster',
  Tyrone: 'Ulster',
  Clare: 'Munster', Cork: 'Munster', Kerry: 'Munster', Limerick: 'Munster',
  Tipperary: 'Munster', Waterford: 'Munster',
  Carlow: 'Leinster', Dublin: 'Leinster', Kildare: 'Leinster', Kilkenny: 'Leinster',
  Laois: 'Leinster', Longford: 'Leinster', Louth: 'Leinster', Meath: 'Leinster',
  Offaly: 'Leinster', Westmeath: 'Leinster', Wexford: 'Leinster', Wicklow: 'Leinster',
  Galway: 'Connacht', Leitrim: 'Connacht', Mayo: 'Connacht', Roscommon: 'Connacht',
  Sligo: 'Connacht',
};

export default function StepClubDetails({ data, onChange }: StepClubDetailsProps) {
  const handleChange = (field: keyof ClubData, value: string) => {
    const updated = { ...data, [field]: value };

    // Auto-fill province when county changes
    if (field === 'county') {
      updated.province = PROVINCE_MAP[value] || '';
    }

    onChange(updated);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Team Details</h2>
        <p className="text-white/50 text-sm">Tell us about your team to get started.</p>
      </div>

      {/* Club Name */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">
          Team Name <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="e.g. Dungloe GAA"
          className="input-glass"
          required
        />
      </div>

      {/* Short Name */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">
          Short Name
        </label>
        <input
          type="text"
          value={data.short_name}
          onChange={(e) => handleChange('short_name', e.target.value)}
          placeholder="e.g. Dungloe"
          className="input-glass"
        />
      </div>

      {/* County */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">
          County
        </label>
        <select
          value={data.county}
          onChange={(e) => handleChange('county', e.target.value)}
          className="input-glass appearance-none cursor-pointer"
        >
          <option value="" className="bg-[#0a1024] text-white/50">
            Select county...
          </option>
          {COUNTIES.map((county) => (
            <option key={county} value={county} className="bg-[#0a1024] text-white">
              {county}
            </option>
          ))}
        </select>
      </div>

      {/* Province (auto-filled, read-only) */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">
          Province
        </label>
        <input
          type="text"
          value={data.province}
          readOnly
          placeholder="Auto-filled from county"
          className="input-glass opacity-60 cursor-not-allowed"
        />
      </div>

      {/* Home Ground */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1.5">
          Home Ground
        </label>
        <input
          type="text"
          value={data.home_ground}
          onChange={(e) => handleChange('home_ground', e.target.value)}
          placeholder="e.g. Rosses Park"
          className="input-glass"
        />
      </div>
    </div>
  );
}

export type { ClubData };
