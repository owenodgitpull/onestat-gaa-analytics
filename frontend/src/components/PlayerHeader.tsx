import { useClub } from '../contexts/ClubContext';

export default function PlayerHeader({ title }: { title: string }) {
  const { club } = useClub();
  const hasClubLogo = !!club?.logo_url;

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-bold text-white">{title}</h1>
      <div className="flex items-center gap-2">
        {hasClubLogo && (
          <img
            src={club.logo_url!}
            alt=""
            className="h-8 w-8 rounded-lg object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <img
          src="/oneStatLogoTransparent.png"
          alt="OneStat"
          className="h-8 object-contain"
        />
      </div>
    </div>
  );
}
