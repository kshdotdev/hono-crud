/**
 * A serialization profile defines how data is shaped for a specific audience.
 */
export interface SerializationProfile {
  /** Unique profile name (e.g. 'public', 'admin', 'internal') */
  name: string;
  /** Fields to include. If empty, includes all fields. */
  include?: string[];
  /** Fields to exclude (applied after include). */
  exclude?: string[];
  /** Fields to always include regardless of other rules (e.g. 'id'). */
  alwaysInclude?: string[];
  /** Relations to include when this profile is active. */
  includeRelations?: string[];
  /** Custom transformer applied after field filtering. */
  transform?: (data: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Configuration for the serialization system.
 */
export interface SerializationConfig {
  /** Available profiles. */
  profiles: SerializationProfile[];
  /** Default profile name when none is specified. */
  defaultProfile?: string;
  /** Query parameter name for selecting profile. @default 'profile' */
  queryParam?: string;
}
