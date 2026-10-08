import * as migration_20261006_000000_module_hierarchy from './20261006_000000_module_hierarchy'
import * as migration_20261009_000000_lock_hierarchy from './20261009_000000_lock_hierarchy'

export const migrations = [
  {
    up: migration_20261006_000000_module_hierarchy.up,
    down: migration_20261006_000000_module_hierarchy.down,
    name: '20261006_000000_module_hierarchy',
  },
  {
    up: migration_20261009_000000_lock_hierarchy.up,
    down: migration_20261009_000000_lock_hierarchy.down,
    name: '20261009_000000_lock_hierarchy',
  },
]
