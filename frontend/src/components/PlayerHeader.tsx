import { useClub } from '../contexts/ClubContext';

export default function PlayerHeader({ title }: { title: string }) {
  const { club, logoUrl } = useClub();

  return (
    <div
      className="sticky top-0 z-40 -mx-4 px-4 pt-3 pb-3 mb-1"
      style={{
        background: 'linear-gradient(180deg, rgba(10,10,25,0.98) 0%, rgba(10,10,25,0.92) 80%, rgba(10,10,25,0) 100%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {logoUrl && (
            <img
              src={logoUrl}
              alt=""
              className="h-9 w-9 rounded-lg object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">{title}</h1>
            {club?.name && (
              <p className="text-[11px] text-white/35 font-medium leading-tight">{club.name}</p>
            )}
          </div>
        </div>
        <img
          src="/oneStatLogoTransparent.png"
          alt="OneStat"
          className="h-7 object-contain opacity-90"
        />
      </div>
    </div>
  );
}
