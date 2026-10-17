import * as migration_20261006_000000_module_hierarchy from './20261006_000000_module_hierarchy'
import * as migration_20261009_000000_lock_hierarchy from './20261009_000000_lock_hierarchy'
import * as migration_20261009_010000_semantic_index from './20261009_010000_semantic_index'
import * as migration_20261015_000000_resumable_ingestion from './20261015_000000_resumable_ingestion'
import * as migration_20261015_010000_page_orientation from './20261015_010000_page_orientation'

export const migrations = [
  // Additive orientation migration runs after the original queue migration below.
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
  {
    up: migration_20261009_010000_semantic_index.up,
    down: migration_20261009_010000_semantic_index.down,
    name: '20261009_010000_semantic_index',
  },
  {
    up: migration_20261015_000000_resumable_ingestion.up,
    down: migration_20261015_000000_resumable_ingestion.down,
    name: '20261015_000000_resumable_ingestion',
  },
  {
    up: migration_20261015_010000_page_orientation.up,
    down: migration_20261015_010000_page_orientation.down,
    name: '20261015_010000_page_orientation',
  },
]
