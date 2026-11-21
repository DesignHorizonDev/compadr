// Views of the console, grouped as in the sidebar. Each view gets its content
// in a later step; the shell shows its title only.

export const NAVIGATION = [
  {
    group: 'Decisions',
    views: [
      { id: 'overview', label: 'Overview' },
      { id: 'feature-map', label: 'Feature map' },
      { id: 'decisions', label: 'Decisions' },
      { id: 'reviews', label: 'Reviews' },
      { id: 'draft', label: 'Draft' },
    ],
  },
  {
    group: 'Code',
    views: [
      { id: 'drift', label: 'Drift' },
      { id: 'links-to-repair', label: 'Links to repair' },
      { id: 'files', label: 'Files' },
      { id: 'coverage', label: 'Coverage' },
    ],
  },
  {
    group: 'Settings',
    views: [
      { id: 'people', label: 'People' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'usage', label: 'AI credits' },
      { id: 'mcp', label: 'MCP & agents' },
    ],
  },
] as const

export type ViewId = (typeof NAVIGATION)[number]['views'][number]['id']

export const DEFAULT_VIEW: ViewId = 'drift'

export function viewLabel(id: ViewId): string {
  for (const { views } of NAVIGATION) {
    for (const view of views) if (view.id === id) return view.label
  }
  return id
}
