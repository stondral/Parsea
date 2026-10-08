import * as migration_20261006_000000_module_hierarchy from './20261006_000000_module_hierarchy'

export const migrations = [
  {
    up: migration_20261006_000000_module_hierarchy.up,
    down: migration_20261006_000000_module_hierarchy.down,
    name: '20261006_000000_module_hierarchy',
  },
]
