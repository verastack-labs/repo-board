import type { PluginOptions } from 'claude-code'

/** The settings from the config menu, cleaned. */
export type Config = { owners: string[]; includeMyAccount: boolean; roots: string[]; scanDepth: number }

const DEFAULT_DEPTH = 3
const MAX_DEPTH = 6

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item !== '')
}

export function readConfig(options: PluginOptions): Config {
  const depth = options.scanDepth
  return {
    owners: asList(options.owners),
    includeMyAccount: options.includeMyAccount !== false,
    roots: asList(options.roots),
    scanDepth: typeof depth === 'number' && Number.isFinite(depth) ? Math.max(0, Math.min(MAX_DEPTH, Math.floor(depth))) : DEFAULT_DEPTH,
  }
}

/** The owners to list: the configured ones, then the signed-in account when included and not already there. */
export function ownersFor(config: Config, login: string | null): string[] {
  const owners = [...config.owners]
  const isListed = login !== null && owners.some(owner => owner.toLowerCase() === login.toLowerCase())
  if (config.includeMyAccount && login !== null && !isListed) owners.push(login)
  return owners
}
