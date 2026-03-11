import { useClub } from '../contexts/ClubContext';

export default function PlayerHeader({ title }: { title: string }) {
  const { club } = useClub();

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-lg font-bold text-white">{title}</h1>
      <img
        src={club?.logo_url || '/oneStatLogoTransparent.png'}
        alt=""
        className="h-10 w-10 rounded-lg object-contain"
        onError={(e) => { (e.target as HTMLImageElement).src = '/oneStatLogoTransparent.png'; }}
      />
    </div>
  );
}
