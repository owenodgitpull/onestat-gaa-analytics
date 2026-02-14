import type { DataTable } from '@/services/api'

interface DataTableCardProps {
  table: DataTable
}

function formatValue(val: unknown): string {
  if (val == null) return '—'
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1)
  }
  return String(val)
}

export default function DataTableCard({ table }: DataTableCardProps) {
  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold text-white mb-3">{table.title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {table.columns.map((col) => (
                <th
                  key={col.key}
                  className="text-left text-[10px] font-semibold uppercase tracking-wider text-white/50 pb-2 pr-4"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.data.map((row, i) => (
              <tr
                key={i}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                {table.columns.map((col) => (
                  <td key={col.key} className="py-2 pr-4 text-white/80">
                    {formatValue(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
